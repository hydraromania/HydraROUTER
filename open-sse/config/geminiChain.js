export const GEMINI_FLASH_CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
];

export const GEMINI_LITE_CHAIN = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
];

// Backward-compat fallback
export const GEMINI_MODEL_CHAIN = [
  ...GEMINI_FLASH_CHAIN,
  "gemini-2.5-flash-lite",
];

// Detect family and slice chain from requested model downward.
export function getGeminiChainFrom(model) {
  const isLite = typeof model === "string" && model.toLowerCase().includes("-lite");
  const targetChain = isLite ? GEMINI_LITE_CHAIN : GEMINI_FLASH_CHAIN;
  const idx = targetChain.indexOf(model);
  return idx === -1 ? [...targetChain] : targetChain.slice(idx);
}

// 404 strike counter per key+model (in-memory; the manual block itself persists
// in rateLimits, only the counter resets on restart).
// ponytail: counts lost on restart. Upgrade path: persist strikes in rateLimits row.
const STRIKE_KEY = "__hydrarouter_gemini404_strikes__";
function getStrikeState() {
  if (!globalThis[STRIKE_KEY]) globalThis[STRIKE_KEY] = { counts: {} };
  return globalThis[STRIKE_KEY];
}

export function recordGemini404Strike(keyId, model) {
  const s = getStrikeState();
  const k = keyId + "|" + model;
  s.counts[k] = (s.counts[k] || 0) + 1;
  return s.counts[k];
}

export function resetGemini404Strikes(keyId, model) {
  const s = getStrikeState();
  delete s.counts[keyId + "|" + model];
}
