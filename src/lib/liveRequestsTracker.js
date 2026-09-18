import { EventEmitter } from "events";

const MAX_LIVE_REQUESTS = 300;

// Active requests older than this are considered stuck (upstream connect +
// stall watchdogs both expired below it: 180s connect + 250s stall). Env
// override: LIVE_REQUEST_STUCK_TIMEOUT_MS.
const STUCK_TIMEOUT_MS = (() => {
  const raw = process.env.LIVE_REQUEST_STUCK_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 10 * 60 * 1000;
})();

// Global singleton tracker to survive Next.js module reloads
if (!global._liveRequestsTracker) {
  global._liveRequestsTracker = {
    emitter: new EventEmitter(),
    active: new Map(), // id -> RequestItem
    aborts: new Map(), // id -> abort() for the in-flight upstream request
    history: [],       // Completed / Failed items (limited to MAX_LIVE_REQUESTS)
  };
  global._liveRequestsTracker.emitter.setMaxListeners(100);
  if (!global._liveRequestsTracker.aborts) global._liveRequestsTracker.aborts = new Map();
}

const tracker = global._liveRequestsTracker;

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

function maskProxyUrl(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== "string") return null;
  try {
    const parsed = new URL(proxyUrl);
    const host = parsed.hostname || "";
    const port = parsed.port ? `:${parsed.port}` : "";
    const protocol = parsed.protocol || "http:";
    return `${protocol}//${host}${port}`;
  } catch {
    return proxyUrl;
  }
}

function sanitizePayloadForLiveView(body) {
  if (!body || typeof body !== "object") return null;
  try {
    const str = JSON.stringify(body, (_key, value) => {
      // Truncate huge base64 strings or images
      if (typeof value === "string" && value.length > 2048 && (value.startsWith("data:") || /^[A-Za-z0-9+/=]{2048,}$/.test(value))) {
        return value.slice(0, 64) + "... [truncated base64]";
      }
      return value;
    });
    if (str.length > 65536) {
      return { _truncated: true, preview: str.slice(0, 65536) + "... [payload truncated over 64KB]" };
    }
    return JSON.parse(str);
  } catch {
    return null;
  }
}

let apiKeyNameCache = { map: {}, ts: 0 };
async function getApiKeyName(apiKey) {
  if (!apiKey) return "Local / Direct";
  if (Date.now() - apiKeyNameCache.ts < 30000 && apiKeyNameCache.map[apiKey]) {
    return apiKeyNameCache.map[apiKey];
  }
  try {
    const { getApiKeys } = await import("./db/repos/apiKeysRepo.js");
    const keys = await getApiKeys();
    const map = {};
    for (const k of keys) {
      map[k.key] = k.name || maskApiKey(k.key);
    }
    apiKeyNameCache = { map, ts: Date.now() };
    return map[apiKey] || maskApiKey(apiKey);
  } catch {
    return maskApiKey(apiKey);
  }
}

function broadcast() {
  tracker.emitter.emit("change");
}

let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast();
  }, 100);
  broadcastTimer?.unref?.();
}

/**
 * Start tracking a request
 * @param {object} params
 * @param {string} params.id
 * @param {string} params.model
 * @param {string} params.provider
 * @param {string} [params.type] - e.g. "chat", "embeddings", "image", "tts", "stt", "search", "fetch"
 * @param {string} [params.endpoint] - e.g. "/v1/chat/completions"
 * @param {string} [params.apiKey] - Raw API key used by client
 * @param {string} [params.connectionId]
 * @param {string} [params.accountName]
 * @param {boolean} [params.stream]
 * @param {string} [params.userAgent]
 * @param {string} [params.clientIp]
 * @param {string} [params.sessionId]
 * @param {string|object} [params.proxy]
 */
export function trackRequestStart({
  id,
  model,
  provider,
  type = "chat",
  endpoint = "/v1/chat/completions",
  apiKey = null,
  connectionId = null,
  accountName = null,
  stream = false,
  userAgent = null,
  clientIp = null,
  sessionId = null,
  messagesCount = 0,
  proxy = null,
  body = null,
}) {
  const reqId = id || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const startTime = Date.now();

  let proxyInfo = null;
  if (proxy) {
    if (typeof proxy === "string") {
      proxyInfo = { url: maskProxyUrl(proxy), rawUrl: proxy };
    } else if (typeof proxy === "object") {
      proxyInfo = {
        url: maskProxyUrl(proxy.url || proxy.proxyUrl || proxy.connectionProxyUrl || proxy.vercelRelayUrl),
        poolId: proxy.poolId || proxy.proxyPoolId || proxy.connectionProxyPoolId || null,
        type: proxy.type || (proxy.vercelRelayUrl ? "relay" : null),
        isAuto: proxy.isAuto || proxy.proxyPoolAuto || false,
      };
    }
  }

  const item = {
    id: reqId,
    timestamp: new Date().toISOString(),
    startTime,
    model: model || "unknown",
    provider: provider || "unknown",
    type,
    endpoint: endpoint || "/v1/chat/completions",
    apiKey: apiKey ? maskApiKey(apiKey) : null,
    rawApiKey: apiKey || null,
    apiKeyName: apiKey ? maskApiKey(apiKey) : "Local / Direct",
    connectionId: connectionId || null,
    accountName: accountName || (connectionId ? `Account ${connectionId.slice(0, 8)}` : "-"),
    stream: !!stream,
    userAgent: userAgent || null,
    clientIp: clientIp || null,
    sessionId: sessionId || null,
    messagesCount: messagesCount || 0,
    proxy: proxyInfo,
    payload: sanitizePayloadForLiveView(body),
    status: "in_progress", // "in_progress" | "completed" | "error"
    tokens: { prompt: 0, completion: 0, cached: 0 },
    duration: 0,
    error: null,
    statusCode: null,
  };

  // Resolve API Key Name asynchronously
  if (apiKey) {
    getApiKeyName(apiKey).then((name) => {
      if (item.apiKeyName !== name) {
        item.apiKeyName = name;
        scheduleBroadcast();
      }
    });
  }

  tracker.active.set(reqId, item);
  scheduleBroadcast();

  return reqId;
}

/**
 * Update request with progress or provider information
 */
export function trackRequestUpdate(id, updates = {}) {
  if (!id) return;
  const item = tracker.active.get(id);
  if (!item) return;

  if (updates.model) item.model = updates.model;
  if (updates.provider) item.provider = updates.provider;
  if (updates.connectionId) item.connectionId = updates.connectionId;
  if (updates.accountName) item.accountName = updates.accountName;
  if (updates.endpoint) item.endpoint = updates.endpoint;
  if (updates.proxy !== undefined) {
    if (updates.proxy) {
      if (typeof updates.proxy === "string") {
        item.proxy = { url: maskProxyUrl(updates.proxy), rawUrl: updates.proxy };
      } else if (typeof updates.proxy === "object") {
        item.proxy = {
          url: maskProxyUrl(updates.proxy.url || updates.proxy.proxyUrl || updates.proxy.connectionProxyUrl || updates.proxy.vercelRelayUrl),
          poolId: updates.proxy.poolId || updates.proxy.proxyPoolId || updates.proxy.connectionProxyPoolId || null,
          type: updates.proxy.type || (updates.proxy.vercelRelayUrl ? "relay" : null),
          isAuto: updates.proxy.isAuto || updates.proxy.proxyPoolAuto || false,
        };
      }
    } else {
      item.proxy = null;
    }
  }
  if (updates.tokens) {
    item.tokens = {
      prompt: updates.tokens.prompt_tokens ?? updates.tokens.input_tokens ?? item.tokens.prompt,
      completion: updates.tokens.completion_tokens ?? updates.tokens.output_tokens ?? item.tokens.completion,
      cached: updates.tokens.cached_tokens ?? updates.tokens.cache_read_input_tokens ?? item.tokens.cached,
    };
  }
  if (updates.ttft) item.ttft = updates.ttft;

  scheduleBroadcast();
}

/**
 * Register an abort callback for an in-flight request so the dashboard can
 * kill the upstream fetch / stream from the Live tab.
 */
export function registerLiveAbort(id, abort) {
  if (!id || typeof abort !== "function") return;
  if (!tracker.active.has(id)) return;
  tracker.aborts.set(id, abort);
}

function mergeTokens(item, tokens) {
  if (!tokens) return;
  item.tokens = {
    prompt: tokens.prompt_tokens ?? tokens.input_tokens ?? item.tokens.prompt,
    completion: tokens.completion_tokens ?? tokens.output_tokens ?? item.tokens.completion,
    cached: tokens.cached_tokens ?? tokens.cache_read_input_tokens ?? item.tokens.cached,
  };
}

/**
 * Mark request as successfully completed.
 * If the entry already settled (double-end from overlapping terminal paths),
 * backfill tokens into the history row instead of silently dropping them.
 */
export function trackRequestEnd(id, { tokens, statusCode = 200, status = "completed" } = {}) {
  if (!id) return;
  const item = tracker.active.get(id);
  if (!item) {
    if (tokens) {
      const hist = tracker.history.find((h) => h.id === id);
      if (hist) {
        mergeTokens(hist, tokens);
        if (statusCode != null) hist.statusCode = statusCode;
        scheduleBroadcast();
      }
    }
    return;
  }

  tracker.active.delete(id);
  tracker.aborts.delete(id);

  item.status = status || "completed";
  item.statusCode = statusCode;
  item.duration = Date.now() - item.startTime;
  mergeTokens(item, tokens);

  // Prepend to history, keeping max limit
  tracker.history.unshift(item);
  if (tracker.history.length > MAX_LIVE_REQUESTS) {
    tracker.history.pop();
  }

  scheduleBroadcast();
}

/**
 * Mark request as failed/error
 */
export function trackRequestError(id, { error, statusCode = 500 } = {}) {
  if (!id) return;
  const item = tracker.active.get(id);
  if (!item) return;

  tracker.active.delete(id);
  tracker.aborts.delete(id);

  item.status = "error";
  item.statusCode = statusCode;
  item.duration = Date.now() - item.startTime;
  item.error = typeof error === "string" ? error : (error?.message || "Unknown error");

  tracker.history.unshift(item);
  if (tracker.history.length > MAX_LIVE_REQUESTS) {
    tracker.history.pop();
  }

  scheduleBroadcast();
}

/**
 * Cancel an in-flight request from the dashboard: aborts the upstream fetch /
 * stream (when an abort callback was registered) and force-moves the item to
 * history. The abort callback normally produces an AbortError somewhere in the
 * request pipeline which itself calls trackRequestError — the delayed sweep
 * below is the safety net for paths where that error never unwinds (the
 * request would otherwise stay in the Active list forever).
 * @returns {{found: boolean, item: object|null}}
 */
export function cancelLiveRequest(id, { reason = "Cancelled from dashboard" } = {}) {
  if (!id) return { found: false, item: null };
  const item = tracker.active.get(id);
  if (!item) return { found: false, item: null };

  const abort = tracker.aborts.get(id);
  if (abort) {
    try { abort(new Error(reason)); } catch { /* best effort */ }
  }

  // If the pipeline hasn't unwound within 1s, force it out manually.
  const timer = setTimeout(() => {
    if (tracker.active.has(id)) {
      trackRequestError(id, { error: reason, statusCode: 499 });
    }
  }, 1000);
  timer?.unref?.();

  return { found: true, item };
}

/**
 * Drop requests that overstayed the whole watchdog budget (connect + stall).
 * Runs on every snapshot — no background timer, no leak risk.
 */
function sweepStuck(now) {
  for (const [id, item] of tracker.active) {
    if (now - item.startTime > STUCK_TIMEOUT_MS) {
      trackRequestError(id, {
        error: `Stuck request expired after ${Math.round((now - item.startTime) / 1000)}s`,
        statusCode: 504,
      });
    }
  }
}

export function getLiveRequestStuckTimeoutMs() {
  return STUCK_TIMEOUT_MS;
}

/**
 * Strip internal-only fields before sending a snapshot to dashboard clients.
 */
function sanitizeForSnapshot(item, now) {
  const { rawApiKey: _raw, aborts: _ab, ...rest } = item;
  return { ...rest, duration: now - item.startTime };
}

/**
 * Get snapshot of active and recent requests
 */
export function getLiveRequestsSnapshot() {
  const now = Date.now();
  sweepStuck(now);
  const active = Array.from(tracker.active.values()).map((item) => sanitizeForSnapshot(item, now));

  // Sort active by start time descending
  active.sort((a, b) => b.startTime - a.startTime);

  const history = tracker.history.slice(0, MAX_LIVE_REQUESTS).map((item) => {
    const { rawApiKey: _raw, aborts: _ab, ...rest } = item;
    return { ...rest };
  });

  return {
    active,
    history,
    // Lets the Live tab scale its "slow / possibly stuck" badges to the same
    // budget the backend sweep uses instead of hardcoded frontend guesses.
    stuckTimeoutMs: STUCK_TIMEOUT_MS,
    stats: {
      activeCount: active.length,
      completedCount: tracker.history.filter((h) => h.status === "completed").length,
      errorCount: tracker.history.filter((h) => h.status === "error").length,
      totalTracked: active.length + tracker.history.length,
    },
  };
}

/**
 * Clear history
 */
export function clearLiveRequestsHistory() {
  tracker.history = [];
  scheduleBroadcast();
}

export const liveRequestsEmitter = tracker.emitter;
