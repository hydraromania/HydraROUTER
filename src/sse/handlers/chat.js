import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  isModelAllowedForApiKey,
} from "../services/auth.js";
import { getResponseFormatOverrideForApiKey } from "@/lib/apiKeyModelFilter.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { isGeminiReroutedToNvidia, isGeminiProvider, findNvidiaComboTarget, recordGemini429Hit, recordGeminiSuccess } from "../services/geminiReroute.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities, recordModelSuccess } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { checkAndRecordRateLimit, rateLimitTracker } from "open-sse/services/rateLimitTracker.js";
import { filterModelsByContext } from "open-sse/providers/models/schema.js";
import { getProviderModels } from "open-sse/config/providerModels.js";
import { trackRequestStart, trackRequestUpdate, trackRequestEnd, trackRequestError } from "@/lib/liveRequestsTracker.js";


/**
 * Estimate token count from request body
 * Rough approximation: 1 token ≈ 4 characters for English text
 */
function estimateRequestTokens(body) {
  if (!body || typeof body !== "object") return 0;
  
  let totalChars = 0;
  
  // Handle messages array (OpenAI/Claude format)
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.content) {
        if (typeof msg.content === "string") {
          totalChars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              totalChars += block.text.length;
            }
          }
        }
      }
    }
  }
  
  // Handle input array (Responses API format)
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item.content) {
        if (typeof item.content === "string") {
          totalChars += item.content.length;
        } else if (Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === "input_text" && block.text) {
              totalChars += block.text.length;
            }
          }
        }
      }
    }
  }
  
  // Handle contents array (Gemini format)
  if (Array.isArray(body.contents)) {
    for (const content of body.contents) {
      if (Array.isArray(content.parts)) {
        for (const part of content.parts) {
          if (part.text) totalChars += part.text.length;
        }
      }
    }
  }
  
  // Add max_tokens if specified (output tokens)
  if (body.max_tokens && typeof body.max_tokens === "number") {
    totalChars += body.max_tokens * 4; // Assume max_tokens worth of output
  }
  
  // Rough token estimation: 1 token ≈ 4 characters
  return Math.ceil(totalChars / 4);
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  if (apiKey) {
    const allowed = await isModelAllowedForApiKey(apiKey, modelStr);
    if (!allowed) {
      log.warn("AUTH", `API key does not have access to model '${modelStr}'`);
      return errorResponse(HTTP_STATUS.FORBIDDEN, `The model '${modelStr}' does not exist or you do not have access to it.`);
    }
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Find ANY available model across all active providers when all combo models are exhausted/blocked.
 * Checks context length, active keys, and rate limit cooldowns.
 */
async function findAnyFallbackModel(body, excludeModels = []) {
  try {
    const estimatedTokens = estimateRequestTokens(body);
    const { getProviderConnections } = await import("@/models");
    const connections = await getProviderConnections();
    const activeConns = connections.filter((c) => c.isActive !== false);
    if (activeConns.length === 0) return null;

    const { getProviderModels } = await import("open-sse/config/providerModels.js");
    const { isModelBlocked } = await import("open-sse/services/combo.js");
    const { rateLimitTracker } = await import("open-sse/services/rateLimitTracker.js");
    const excludeSet = new Set(excludeModels || []);

    // Group active connections by provider
    const byProvider = new Map();
    for (const c of activeConns) {
      if (!byProvider.has(c.provider)) byProvider.set(c.provider, []);
      byProvider.get(c.provider).push(c);
    }

    for (const [providerId, conns] of byProvider.entries()) {
      const models = getProviderModels(providerId) || [];
      for (const m of models) {
        if (m.kind && m.kind !== "llm") continue;
        const fullModel = `${providerId}/${m.id}`;
        if (excludeSet.has(fullModel) || excludeSet.has(m.id)) continue;
        if (isModelBlocked(fullModel)) continue;

        // Context check: skip models whose context limit is smaller than request tokens
        if (estimatedTokens > 0 && m.contextLength && m.contextLength < estimatedTokens) {
          continue;
        }

        // Check if at least one connection for this provider is NOT rate-limited
        let hasAvailableKey = false;
        for (const c of conns) {
          const chk = await rateLimitTracker.checkLimit(c.id, m.id, providerId, estimatedTokens);
          if (chk.allowed) {
            hasAvailableKey = true;
            break;
          }
        }

        if (hasAvailableKey) {
          return fullModel;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const modelInfo = await getModelInfo(modelStr);

  // Check context length for single model requests
  if (modelInfo.provider && modelInfo.model) {
    const estimatedTokens = estimateRequestTokens(body);
    if (estimatedTokens > 0) {
      const providerModelsMap = getProviderModels(modelInfo.provider);
      const modelDef = providerModelsMap.find(m => m.id === modelInfo.model);
      if (modelDef && modelDef.contextLength && estimatedTokens > modelDef.contextLength) {
        log.warn("CONTEXT", `Request (${estimatedTokens} tokens) exceeds ${modelStr} context limit (${modelDef.contextLength}), finding alternative`);
        
        // Get all models from the same provider that support the context
        const suitableModels = providerModelsMap
          .filter(m => m.contextLength && m.contextLength >= estimatedTokens)
          .sort((a, b) => (a.contextLength || 0) - (b.contextLength || 0));
        
        if (suitableModels.length > 0) {
          const alternativeModel = `${modelInfo.provider}/${suitableModels[0].id}`;
          log.info("CONTEXT", `Redirecting to ${alternativeModel} (context: ${suitableModels[0].contextLength})`);
          return handleSingleModelChat(body, alternativeModel, clientRawRequest, request, apiKey);
        }
      }
    }
  }

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const augmentedModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m));

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      const comboRes = await handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });

      // If all combo models were exhausted/blocked, try finding ANY available model that fits
      if (!comboRes.ok) {
        const fallbackModel = await findAnyFallbackModel(body, augmentedModels);
        if (fallbackModel) {
          log.warn("COMBO", `Toate modelele din combo "${modelStr}" sunt blocate/indisponibile. Fallback de urgență → ${fallbackModel}`);
          const fallbackRes = await handleSingleModelChat(body, fallbackModel, clientRawRequest, request, apiKey);
          if (fallbackRes.ok) return fallbackRes;
        }
      }

      return comboRes;
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Check if Gemini provider is currently rerouted to nVidia combo after 7 consecutive 429s
  if (isGeminiProvider(provider) && isGeminiReroutedToNvidia()) {
    const nvidiaCombo = await findNvidiaComboTarget();
    if (nvidiaCombo) {
      log.warn("GEMINI_REROUTE", `Gemini provider is active in 2m cooldown after 7 consecutive 429s → rerouting request to combo "${nvidiaCombo}"`);
      return handleSingleModelChat(body, nvidiaCombo, clientRawRequest, request, apiKey);
    }
  }

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Check model rate limits per key before routing
    const modelStr = `${provider}/${model}`;
    const estimatedTokens = estimateRequestTokens(body);
    const rateLimitCheck = await checkAndRecordRateLimit(credentials.connectionId, modelStr, estimatedTokens);
    if (!rateLimitCheck.allowed) {
      log.warn("RATE_LIMIT", `Key ${credentials.connectionName} rate limited for ${modelStr}: ${rateLimitCheck.message}`);
      // Mark this connection as unavailable for this model temporarily
      excludeConnectionIds.add(credentials.connectionId);
      lastError = rateLimitCheck.message;
      lastStatus = HTTP_STATUS.TOO_MANY_REQUESTS;
      continue;
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const responseFormatOverride = await getResponseFormatOverrideForApiKey(apiKey);
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      responseFormatOverride,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
        if (isGeminiProvider(provider)) {
          recordGeminiSuccess();
        }
        // Auto proxy-pool mode: success clears this proxy's 429 strikes.
        if (credentials.providerSpecificData?.proxyPoolAuto && credentials.providerSpecificData?.connectionProxyPoolId) {
          const { recordAutoProxySuccess } = await import("@/lib/network/autoProxyPool.js");
          await recordAutoProxySuccess(credentials.providerSpecificData.connectionProxyPoolId);
        }
      }
    });

    if (result.success) {
      // Record successful response for rate limit tracking (increments RPD only)
      await rateLimitTracker.recordSuccess(credentials.connectionId, model, provider);
      recordModelSuccess(`${provider}/${model}`);
      if (isGeminiProvider(provider)) {
        recordGeminiSuccess();
      }
      return result.response;
    }

    // Record timeout or server errors for model blocking (3 strikes -> 24h block)
    if (result.status === 504 || result.status === 503) {
      const { recordModelFailure } = await import("open-sse/services/combo.js");
      recordModelFailure(`${provider}/${model}`, result.status);
    }

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    // Record 429 rate limit hit for 60s cooldown
    if (result.status === 429) {
      if (isGeminiProvider(provider)) {
        const geminiRes = recordGemini429Hit(model, credentials.connectionId);
        if (geminiRes.rerouted) {
          log.warn("GEMINI_REROUTE", `Gemini reached 7 consecutive 429s → rerouted to nVidia combo for 2 minutes (until ${new Date(geminiRes.reroutedUntil).toISOString()})`);
        }
      }
      await rateLimitTracker.recordRateLimitHit(credentials.connectionId, model, provider);
      // Auto proxy-pool mode: 3 consecutive 429s auto-pause this proxy for 3h.
      if (credentials.providerSpecificData?.proxyPoolAuto && credentials.providerSpecificData?.connectionProxyPoolId) {
        const { recordAutoProxyRateLimit } = await import("@/lib/network/autoProxyPool.js");
        const autoRes = await recordAutoProxyRateLimit(credentials.providerSpecificData.connectionProxyPoolId);
        if (autoRes.paused) {
          log.warn("PROXY", `Auto proxy ${String(credentials.providerSpecificData.connectionProxyPoolId).slice(0, 8)} paused 3h after 3x consecutive 429 → rotating to next`);
        }
      }
    }
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
