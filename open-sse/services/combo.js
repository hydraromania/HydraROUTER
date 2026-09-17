/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";
import { filterModelsByContext } from "../providers/models/schema.js";
import { getProviderModels } from "../config/providerModels.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ]";

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

// Model failure tracking for 503/504 errors
// Tracks consecutive 503/504 errors across different keys
// After 3 failures, model is blocked for 1 hour
const MODEL_FAILURE_TRACKER = new Map(); // modelStr -> { count, blockedUntil, lastErrorTime }

const MODEL_BLOCK_THRESHOLD = 3;
const MODEL_BLOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Last successful use per model (in-memory). Backs idle-probe policies:
// a model idle longer than the policy window gets a synthetic liveness
// ping before real user data is sent to it.
const MODEL_LAST_SUCCESS = new Map(); // modelStr -> timestamp ms

/**
 * Record a successful response for a model (feeds idle detection).
 */
export function recordModelSuccess(modelStr) {
  if (!modelStr) return;
  MODEL_LAST_SUCCESS.set(modelStr, Date.now());
}

/**
 * Last successful use timestamp (ms) or 0 when unknown.
 */
export function getModelLastSuccess(modelStr) {
  return MODEL_LAST_SUCCESS.get(modelStr) || 0;
}

// Idle-probe policy for nVidia: a model with no success in the last hour
// gets a synthetic "ping" before real user data is sent to it. Probe miss
// → skip to next model + block this one for 1h. Probe timeout is kept short
// (8s) so combo rotation stays fast instead of stalling on a dead slot.
export const NVIDIA_IDLE_PROBE_MS = 60 * 60 * 1000;
export const NVIDIA_PROBE_BLOCK_MS = 60 * 60 * 1000;
const NVIDIA_PROBE_TIMEOUT_MS = 8 * 1000;

export function isNvidiaModel(modelStr) {
  return typeof modelStr === "string" && modelStr.toLowerCase().startsWith("nvidia/");
}

export function needsIdleProbe(modelStr, now = Date.now()) {
  return isNvidiaModel(modelStr) && now - getModelLastSuccess(modelStr) > NVIDIA_IDLE_PROBE_MS;
}

// Async variant: memory first, then persisted usageHistory (covers process
// restarts where the in-memory map is empty). Unknown → idle (fail-safe:
// verify before trusting a stale nVidia slot with real user data).
export async function isIdleBeyondHour(modelStr, now = Date.now()) {
  if (!isNvidiaModel(modelStr)) return false;
  if (now - getModelLastSuccess(modelStr) <= NVIDIA_IDLE_PROBE_MS) return false;
  try {
    const slash = modelStr.indexOf("/");
    const { getLastModelUsageAt } = await import("@/lib/db/repos/usageRepo.js");
    const ts = await getLastModelUsageAt(modelStr.slice(0, slash), modelStr.slice(slash + 1));
    if (ts) {
      MODEL_LAST_SUCCESS.set(modelStr, ts);
      return now - ts > NVIDIA_IDLE_PROBE_MS;
    }
  } catch {}
  return true;
}

export function buildIdleProbeBody(body) {
  const probe = { ...body, stream: false, max_tokens: 1, max_completion_tokens: 1 };
  delete probe.tools;
  delete probe.tool_choice;
  delete probe.stream_options;
  delete probe.response_format;
  if (Array.isArray(body?.messages)) probe.messages = [{ role: "user", content: "ping" }];
  else if (Array.isArray(body?.input)) probe.input = [{ role: "user", content: "ping" }];
  else if (Array.isArray(body?.contents)) probe.contents = [{ role: "user", parts: [{ text: "ping" }] }];
  else probe.messages = [{ role: "user", content: "ping" }];
  return probe;
}

export async function probeIdleModel(handleSingleModel, body, modelStr, log) {
  log?.info?.("COMBO", `Probing idle nVidia model ${modelStr} (no success in last hour)`);
  let timer = null;
  const abortController = new AbortController();
  try {
    const timeout = new Promise((res) => {
      timer = setTimeout(() => {
        try { abortController.abort(); } catch {}
        res({ ok: false, timedOut: true });
      }, NVIDIA_PROBE_TIMEOUT_MS);
      timer?.unref?.();
    });

    const probeBody = buildIdleProbeBody(body);
    const probePromise = handleSingleModel(probeBody, modelStr, null, { signal: abortController.signal }).then(
      async (r) => {
        const isOk = !!r?.ok;
        if (isOk) recordModelSuccess(modelStr);
        // Explicitly drain or cancel response body to decouple connection and release socket
        try {
          if (r?.body) {
            if (typeof r.body.cancel === "function") {
              await r.body.cancel();
            } else if (typeof r.body.destroy === "function") {
              r.body.destroy();
            }
          }
        } catch {}
        return { ok: isOk, res: r };
      },
      () => ({ ok: false })
    );

    const probed = await Promise.race([probePromise, timeout]);
    return probed.ok === true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    try { abortController.abort(); } catch {}
  }
}

/**
 * Check if a model is currently blocked due to repeated 503/504 errors
 */
export function isModelBlocked(modelStr) {
  const tracker = MODEL_FAILURE_TRACKER.get(modelStr);
  if (!tracker) return false;
  if (tracker.blockedUntil && Date.now() < tracker.blockedUntil) return true;
  // Block expired, clean up
  if (tracker.blockedUntil && Date.now() >= tracker.blockedUntil) {
    MODEL_FAILURE_TRACKER.delete(modelStr);
    return false;
  }
  return false;
}

/**
 * Record a 503/504 error for a model
 * Returns true if model should now be blocked
 */
export function recordModelFailure(modelStr, status) {
  if (status !== 503 && status !== 504) return false;
  
  const now = Date.now();
  const tracker = MODEL_FAILURE_TRACKER.get(modelStr) || { count: 0, blockedUntil: null, lastErrorTime: 0 };
  
  // Reset count if last error was more than 10 minutes ago (different incident)
  if (tracker.lastErrorTime && now - tracker.lastErrorTime > 10 * 60 * 1000) {
    tracker.count = 0;
  }
  
  tracker.count += 1;
  tracker.lastErrorTime = now;
  
  if (tracker.count >= MODEL_BLOCK_THRESHOLD) {
    tracker.blockedUntil = now + MODEL_BLOCK_DURATION_MS;
    console.warn(`[COMBO] Model ${modelStr} blocked for 24 hours after ${MODEL_BLOCK_THRESHOLD} timeouts/503/504 errors`);
  }
  
  MODEL_FAILURE_TRACKER.set(modelStr, tracker);
  return tracker.count >= MODEL_BLOCK_THRESHOLD;
}

/**
 * Record a timeout error for a model
 */
export function recordModelTimeout(modelStr) {
  return recordModelFailure(modelStr, 504);
}

/**
 * Manually block a model for a short duration (dashboard "reroute" action).
 * Skips the 3-strike threshold so the SAME client's immediate retry/combo
 * fallback lands on a different model right away.
 * @param {string} modelStr
 * @param {number} durationMs
 */
export function blockModel(modelStr, durationMs = 10 * 60 * 1000) {
  if (!modelStr) return false;
  const now = Date.now();
  const tracker = MODEL_FAILURE_TRACKER.get(modelStr) || { count: 0, blockedUntil: null, lastErrorTime: 0 };
  // Keep the longest active block — don't shorten an existing one.
  if (!tracker.blockedUntil || tracker.blockedUntil < now + durationMs) {
    tracker.blockedUntil = now + durationMs;
  }
  tracker.lastErrorTime = now;
  MODEL_FAILURE_TRACKER.set(modelStr, tracker);
  console.warn(`[COMBO] Model ${modelStr} manually blocked for ${Math.round(durationMs / 1000)}s (reroute)`);
  return true;
}

/**
 * Get all blocked models
 */
export function getBlockedModels() {
  const now = Date.now();
  const blocked = [];
  for (const [modelStr, tracker] of MODEL_FAILURE_TRACKER.entries()) {
    if (tracker.blockedUntil && now < tracker.blockedUntil) {
      blocked.push({
        model: modelStr,
        failureCount: tracker.count,
        blockedUntil: tracker.blockedUntil,
        remainingMs: tracker.blockedUntil - now,
        lastErrorTime: tracker.lastErrorTime
      });
    }
  }
  return blocked;
}

/**
 * Manually unblock a model
 */
export function unblockModel(modelStr) {
  const tracker = MODEL_FAILURE_TRACKER.get(modelStr);
  if (tracker) {
    tracker.count = 0;
    tracker.blockedUntil = null;
    tracker.lastErrorTime = 0;
    MODEL_FAILURE_TRACKER.set(modelStr, tracker);
    return true;
  }
  return false;
}

/**
 * Clear all model blocks
 */
export function clearAllModelBlocks() {
  MODEL_FAILURE_TRACKER.clear();
  return true;
}

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  return models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime) => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      // Infer modality from embedded mime when available; fall back to pdf for generic files.
      let fmime = null;
      if (b.input_audio?.format) fmime = `audio/${b.input_audio.format}`;
      else if (b.file?.file_data) fmime = String(b.file.file_data).match(/^data:([^;,]+)/)?.[1];
      else if (b.source?.media_type) fmime = b.source.media_type;
      else if (b.source?.data) fmime = String(b.source.data).match(/^data:([^;,]+)/)?.[1];
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    // gemini parts: inlineData/fileData carry a mime
    addByMime(b.inlineData?.mimeType || b.fileData?.mimeType);
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  const scanMessage = (m) => {
    if (!m || typeof m !== "object") return;

    // Ollama / Hermes images array (strings or objects)
    if (Array.isArray(m.images) && m.images.length > 0) {
      required.add("vision");
    }

    // Vercel AI SDK / Hermes attachments / experimental_attachments
    const attachments = m.experimental_attachments || m.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att) continue;
        const mime = att.contentType || att.mediaType || (typeof att.url === "string" && att.url.match(/^data:([^;,]+)/)?.[1]);
        if (mime) addByMime(mime);
        else if (att.url || att.data) required.add("vision");
      }
    }

    // Direct message-level modality properties
    if (m.image_url || m.image) required.add("vision");
    if (m.audio_url || m.audio) required.add("audioInput");

    // Scan array content blocks
    scanContent(m.content);

    // Scan string content for embedded data URIs
    if (typeof m.content === "string") {
      if (m.content.includes("data:image/")) required.add("vision");
      else if (m.content.includes("data:audio/")) required.add("audioInput");
      else if (m.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanMessage(m);              // openai / claude / hermes / ollama
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  // search: temporarily disabled in auto-switch (feature not wired yet).

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true }) {
  // Apply rotation strategy if enabled
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }

  // Filter models by context length - only try models that can handle the request size
  const estimatedTokens = estimateRequestTokens(body);
  if (estimatedTokens > 0) {
    const providerModelsMap = getProviderModels ? await import("../config/providerModels.js").then(m => m.getProviderModels()) : {};
    const originalCount = rotatedModels.length;
    rotatedModels = filterModelsByContext(rotatedModels, providerModelsMap, estimatedTokens);
    if (rotatedModels.length < originalCount) {
      log.info("COMBO", `Filtered ${originalCount} models to ${rotatedModels.length} with sufficient context (>= ${estimatedTokens} tokens)`);
    }
  }
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    
    // Skip blocked models
    if (isModelBlocked(modelStr)) {
      log.warn("COMBO", `Model ${modelStr} is blocked (rate limit threshold exceeded), skipping`);
      continue;
    }

    // nVidia idle policy: no success in the last hour → synthetic liveness
    // ping before real user data. Probe miss → next model + 1h block.
    if (await isIdleBeyondHour(modelStr)) {
      const alive = await probeIdleModel(handleSingleModel, body, modelStr, log);
      if (!alive) {
        blockModel(modelStr, NVIDIA_PROBE_BLOCK_MS);
        log.warn("COMBO", `Idle probe failed for ${modelStr}, blocked 1h → next`);
        lastError = `Idle probe failed for ${modelStr}`;
        if (!lastStatus) lastStatus = 503;
        continue;
      }
    }
    
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      
      // Success (2xx) - return response
      if (result.ok) {
        recordModelSuccess(modelStr);
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      // Extract error info from response
      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // Record failure for 503/504 to block model if threshold reached
      recordModelFailure(modelStr, result.status);

      // For transient server errors (503/502/504), wait briefly before falling through
      // so a briefly-overloaded provider gets a chance to recover.
      // Rate limit / TPM / RPM errors skip this wait immediately.
      const isRateLimitError = result.status === 429 || 
        (errorText && /rate limit|exceeded|quota|tpm|rpm|rpd|retry after/i.test(errorText));
      if (!isRateLimitError && cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });

      // Record timeout or network failure as model failure
      if (lastError.toLowerCase().includes("timeout") || lastError.toLowerCase().includes("abort")) {
        recordModelTimeout(modelStr);
      }
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped (we want prose).
  const { tools, tool_choice, stream_options, ...rest } = body;
  // Fusion runs panel models non-streaming; drop stream_options too, or providers
  // like DeepSeek reject it with "stream_options should be set along with stream = true".
  // See issue #3024.
  const panelBody = { ...rest, stream: false };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
