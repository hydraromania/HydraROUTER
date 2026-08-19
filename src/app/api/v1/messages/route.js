// GitHub Copilot Claude-compatible endpoint
// POST /v1/messages - routes Claude models through GitHub Copilot subscription
// Compatible with Anthropic Messages API format

import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { getProviderCredentials, markAccountUnavailable, clearAccountError, extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getModelInfo } from "@/sse/services/model.js";
import { getSettings } from "@/lib/localDb";
import { updateProviderCredentials, checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "@/sse/utils/logger.js";

const COPILOT_CLAUDE_PROVIDER = "copilot-claude";
const ROTATION_STATUSES = new Set([HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN, HTTP_STATUS.RATE_LIMITED]);

async function requireValidApiKey(request) {
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  return null;
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const raw = await request.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
    }
    return { raw, parsed };
  }
  return { raw: await request.text(), parsed: null };
}

function toOpenAIMessages(anthropicBody) {
  // Convert Anthropic Messages format to OpenAI Chat Completions format
  const { system, messages, ...rest } = anthropicBody;
  const openaiMessages = [];

  if (system) {
    if (typeof system === "string") {
      openaiMessages.push({ role: "system", content: system });
    } else if (Array.isArray(system)) {
      for (const block of system) {
        if (block.type === "text") openaiMessages.push({ role: "system", content: block.text });
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      if (typeof msg.content === "string") {
        openaiMessages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Handle content blocks (text, image, tool_use, tool_result)
        const contentParts = [];
        let toolCalls = null;
        for (const block of msg.content) {
          if (block.type === "text") {
            contentParts.push({ type: "text", text: block.text });
          } else if (block.type === "image") {
            contentParts.push({ type: "image_url", image_url: { url: block.source?.data ? `data:${block.source.media_type};base64,${block.source.data}` : block.source?.url } });
          } else if (block.type === "tool_use") {
            if (!toolCalls) toolCalls = [];
            toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } });
          } else if (block.type === "tool_result") {
            openaiMessages.push({ role: "tool", tool_call_id: block.tool_use_id, content: JSON.stringify(block.content) });
          }
        }
        if (contentParts.length > 0 || toolCalls) {
          openaiMessages.push({ role: msg.role, content: contentParts.length > 0 ? contentParts : null, tool_calls: toolCalls });
        }
      }
    }
  }

  return { messages: openaiMessages, ...rest };
}

function toAnthropicResponse(openaiResponse) {
  // Convert OpenAI response to Anthropic Messages format
  const choice = openaiResponse.choices?.[0];
  if (!choice) return { type: "error", error: { type: "api_error", message: "No response" } };

  const content = [];
  if (choice.message?.content) content.push({ type: "text", text: choice.message.content });
  if (choice.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
    }
  }

  return {
    id: openaiResponse.id?.replace("chatcmpl-", "msg_") || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: openaiResponse.model,
    stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: openaiResponse.usage ? { input_tokens: openaiResponse.usage.prompt_tokens, output_tokens: openaiResponse.usage.completion_tokens } : { input_tokens: 0, output_tokens: 0 },
  };
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/messages - GitHub Copilot Claude route */
export async function POST(request) {
  const authError = await requireValidApiKey(request);
  if (authError) return authError;

  const bodyInfo = await readBody(request);
  if (bodyInfo.error) return bodyInfo.error;

  const { parsed: anthropicBody } = bodyInfo;
  if (!anthropicBody) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid request body");

  // Convert to OpenAI format for internal routing
  const openaiBody = toOpenAIMessages(anthropicBody);

  // Force provider to GitHub Copilot with Claude model
  const provider = "github";
  const model = "claude-3.5-sonnet"; // or extract from request if specified

  const modelInfo = getModelInfo(`${provider}/${model}`);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Combos not supported for this endpoint");

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { preferredConnectionId });

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Use the chat core with OpenAI-format body
    const result = await handleChatCore({
      body: { ...openaiBody, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest: request,
      connectionId: credentials.connectionId,
      userAgent: request.headers.get("user-agent") || "",
      apiKey: null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
    });

    if (result.success) {
      const openaiResponse = await result.response.json();
      const anthropicResponse = toAnthropicResponse(openaiResponse);
      return new Response(JSON.stringify(anthropicResponse), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-9router-connection-id": credentials.connectionId },
      });
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId, result.status, result.error, provider, model
    );

    if (shouldFallback && ROTATION_STATUSES.has(result.status)) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}