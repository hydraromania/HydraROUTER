import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";

const OPENCODE_GO_UA = "opencode-go";
// Models served by /zen/go/v1/responses; every other model stays on /chat/completions.
const RESPONSES_MODELS = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  const base = baseModelId(model);
  return RESPONSES_MODELS.has(base) || isMuseSparkModel(base);
}

function resolveOpencodeGoSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode-go",
    generate: generateSessionId,
  });
}

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS.opencodeGo);
    this._currentSessionId = null;
  }

  transformRequest(model, body, credentials) {
    this._currentSessionId = resolveOpencodeGoSession(body, credentials);
    if (isResponsesModel(model)) {
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      // normalizeOpencodeReasoning(model, body); // Removed as reasoning is not part of this fix
    }
    // injectReasoningContent({ provider: this.provider, model, body }); // Removed as reasoning is not part of this fix
    return body;
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return isResponsesModel(model)
      ? `${base}/zen/go/v1/responses` // Corrected path for opencode-go responses
      : `${base}/zen/go/v1/chat/completions`; // Corrected path for opencode-go completions
  }

  buildHeaders(credentials, stream = true) {
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = lower["user-agent"] || "";
    const isOpencodeGoDownstream = downstreamUa.toLowerCase().includes("opencode-go") || downstreamUa.toLowerCase().includes("opencode");

    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials?.apiKey || credentials?.accessToken || "public"}`,
      "User-Agent": isOpencodeGoDownstream ? downstreamUa : OPENCODE_GO_UA,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": lower["x-opencode-session"] || this._currentSessionId || generateSessionId(),
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-project": lower["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
  }
}