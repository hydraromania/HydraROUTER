/**
 * Gemini 429 consecutive error strike tracker & redirection to nVidia combo.
 * 
 * Rule:
 * If 7 consecutive model requests to the Gemini provider fail with 429 (Too Many Requests),
 * the Gemini provider is redirected to the "nVidia" combo for 2 minutes (120,000 ms).
 * A successful request through Gemini resets the consecutive strike counter.
 */

import { getCombos } from "@/lib/localDb";

const GEMINI_STRIKE_THRESHOLD = 7;
const GEMINI_REROUTE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

const STATE_KEY = "__hydrarouter_gemini_reroute_state__";

// Ensure state survives hot-reloads / module re-imports
function getState() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = {
      consecutive429Count: 0,
      reroutedUntil: 0,
      history: [],
    };
  }
  return globalThis[STATE_KEY];
}

/**
 * Check if the Gemini provider is currently redirected to the nVidia combo.
 * @returns {boolean}
 */
export function isGeminiReroutedToNvidia() {
  const state = getState();
  const now = Date.now();
  if (state.reroutedUntil && now < state.reroutedUntil) {
    return true;
  }
  if (state.reroutedUntil && now >= state.reroutedUntil) {
    state.reroutedUntil = 0;
  }
  return false;
}

/**
 * Check if a provider identifier corresponds to Gemini.
 * @param {string} provider
 * @returns {boolean}
 */
export function isGeminiProvider(provider) {
  if (!provider) return false;
  const p = String(provider).toLowerCase();
  return p === "gemini" || p === "gemini-cli";
}

/**
 * Resolve the target nVidia combo name or models.
 * Looks for combos named (case-insensitive) "nVidia", "nvidia", or starting with "nvidia".
 * @returns {Promise<string|null>} combo name if exists
 */
export async function findNvidiaComboTarget() {
  try {
    const combos = await getCombos();
    if (!combos || combos.length === 0) return null;
    // Prefer exact case-insensitive match for "nvidia"
    const exact = combos.find((c) => c.name && c.name.toLowerCase() === "nvidia");
    if (exact) return exact.name;
    // Otherwise any combo containing nvidia
    const partial = combos.find((c) => c.name && c.name.toLowerCase().includes("nvidia"));
    if (partial) return partial.name;
    return null;
  } catch {
    return null;
  }
}

/**
 * Record a 429 error for Gemini.
 * @param {string} [model] - Model name that hit 429
 * @param {string} [keyId] - Connection ID / key used
 * @returns {{ consecutive429Count: number, rerouted: boolean, reroutedUntil: number }}
 */
export function recordGemini429Hit(model = null, keyId = null) {
  const state = getState();
  const now = Date.now();

  state.consecutive429Count += 1;
  state.history.push({ time: now, model, keyId });
  if (state.history.length > 20) {
    state.history.shift();
  }

  let rerouted = false;
  if (state.consecutive429Count >= GEMINI_STRIKE_THRESHOLD) {
    state.reroutedUntil = now + GEMINI_REROUTE_DURATION_MS;
    state.consecutive429Count = 0; // Reset counter once triggered
    rerouted = true;
  }

  return {
    consecutive429Count: state.consecutive429Count,
    rerouted,
    reroutedUntil: state.reroutedUntil,
  };
}

/**
 * Record a successful request through Gemini to reset consecutive 429 strikes.
 */
export function recordGeminiSuccess() {
  const state = getState();
  state.consecutive429Count = 0;
}

/**
 * Get current Gemini reroute status.
 */
export function getGeminiRerouteStatus() {
  const state = getState();
  const now = Date.now();
  const active = state.reroutedUntil > now;
  return {
    active,
    consecutive429Count: state.consecutive429Count,
    reroutedUntil: active ? state.reroutedUntil : 0,
    remainingMs: active ? Math.max(0, state.reroutedUntil - now) : 0,
  };
}

/**
 * Reset Gemini reroute state (useful for tests or manual unblock).
 */
export function resetGeminiRerouteState() {
  const state = getState();
  state.consecutive429Count = 0;
  state.reroutedUntil = 0;
  state.history = [];
}
