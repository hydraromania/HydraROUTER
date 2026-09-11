import REGISTRY from "../providers/registry/index.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "./runtimeConfig.js";

export const DEFAULT_MODEL_LIMITS = {
  rpm: Infinity,
  tpm: Infinity,
  rpd: Infinity,
  rpdResetHour: 0,
  timeoutMs: FETCH_CONNECT_TIMEOUT_MS,
};

export const DEFAULT_RESET_TZ = "Europe/Bucharest";

// Runtime overrides layered over the registry, persisted in settings.rateLimitOverrides.
// Keys: "provider/model" for model-level, "provider/*" for provider-level.
// Shape: { rpm?, tpm?, rpd?, timeout? (seconds), rpdResetHour?, resetTz? }
// Backed by globalThis so all Next.js route chunks share one map in-process.
const GLOBAL_OVERRIDES_KEY = "__hydrarouter_modelLimitOverrides__";
if (!globalThis[GLOBAL_OVERRIDES_KEY]) globalThis[GLOBAL_OVERRIDES_KEY] = new Map();
const LIMIT_OVERRIDES = globalThis[GLOBAL_OVERRIDES_KEY];

export function setModelLimitOverrides(overrides) {
  LIMIT_OVERRIDES.clear();
  for (const [key, val] of Object.entries(overrides || {})) {
    if (val && typeof val === "object") LIMIT_OVERRIDES.set(key, { ...val });
  }
}

export function getModelLimitOverrides() {
  return Object.fromEntries(LIMIT_OVERRIDES.entries());
}

function overrideFor(providerId, modelId) {
  const modelLevel = LIMIT_OVERRIDES.get(`${providerId}/${modelId}`) || {};
  const providerLevel = LIMIT_OVERRIDES.get(`${providerId}/*`) || {};
  return { ...providerLevel, ...modelLevel };
}

// REGISTRY entries list: index by provider id for fast lookup of rpm/tpm/rpd/rateLimits
const REGISTRY_BY_ID = {};
for (const entry of REGISTRY) {
  if (entry?.id) REGISTRY_BY_ID[entry.id] = entry;
}

function pickNum(...vals) {
  for (const v of vals) {
    if (v != null && v !== "") { const n = Number(v); if (Number.isFinite(n)) return n; }
  }
  return Infinity;
}

/**
 * Get rate limits and timeout for a specific model from provider registry (Available Models).
 * Each model can specify rpm, tpm, rpd, and timeout (in seconds).
 * If empty/undefined, means unlimited for RPM/TPM/RPD, and default timeout.
 * Provider-level `rateLimits: {...}` in the registry entry acts as defaults for all models
 * (e.g. nvidia resets RPD at 00:00 Europe, gemini at 10:00).
 */
export function getModelRateLimits(providerId, modelId) {
  const providerDef = REGISTRY_BY_ID[providerId];
  const provDefaults = providerDef?.rateLimits || {};
  const models = providerDef?.models || [];
  const modelDef = models.find((m) => (typeof m === "string" ? m : m?.id) === modelId);
  const md = typeof modelDef === "string" ? {} : (modelDef || {});
  const ov = overrideFor(providerId, modelId);

  // Precedence: runtime override → registry model → registry provider defaults
  const rpm = pickNum(ov.rpm, md.rpm, provDefaults.rpm);
  const tpm = pickNum(ov.tpm, md.tpm, provDefaults.tpm);
  const rpd = pickNum(ov.rpd, md.rpd, provDefaults.rpd);
  const rpdResetHour = Number.isFinite(Number(ov.rpdResetHour ?? md.rpdResetHour ?? provDefaults.rpdResetHour))
    ? Number(ov.rpdResetHour ?? md.rpdResetHour ?? provDefaults.rpdResetHour)
    : 0;
  const resetTz = ov.resetTz || md.resetTz || provDefaults.resetTz || DEFAULT_RESET_TZ;
  // timeout in SECONDS from UI; registry `timeout` also seconds. timeoutMs fields win as-is.
  const timeoutSec = ov.timeout ?? md.timeout ?? provDefaults.timeout;
  const timeoutMs = ov.timeoutMs ?? (timeoutSec != null && timeoutSec !== "" ? Number(timeoutSec) * 1000 : (md.timeoutMs || FETCH_CONNECT_TIMEOUT_MS));

  return { rpm, tpm, rpd, rpdResetHour, resetTz, timeoutMs };
}

/**
 * True when the provider has any model-level or provider-level rate limit configured.
 */
export function hasRateLimitConfig(providerId) {
  const providerDef = REGISTRY_BY_ID[providerId];
  if (!providerDef) return false;
  if (providerDef.rateLimits && Object.keys(providerDef.rateLimits).length > 0) return true;
  return (providerDef.models || []).some((m) => {
    const md = typeof m === "string" ? {} : m;
    return md.rpm != null || md.tpm != null || md.rpd != null || md.rpdResetHour != null;
  });
}

// Models with limits worth a dashboard row: explicit rpm/tpm/rpd on the model entry,
// else (provider-level defaults) every llm-ish model of the provider.
export function getConfiguredModelsForProvider(providerId) {
  const def = REGISTRY_BY_ID[providerId];
  if (!def) return [];
  const models = def.models || [];
  const explicit = models.filter((m) => typeof m !== "string" && (m.rpm != null || m.tpm != null || m.rpd != null));
  if (explicit.length > 0) return explicit.map((m) => m.id);
  if (def.rateLimits && Object.keys(def.rateLimits).length > 0) {
    return models
      .map((m) => (typeof m === "string" ? { id: m } : m))
      .filter((m) => !m.kind || m.kind === "llm")
      .map((m) => m.id);
  }
  return [];
}

// Offset of `tz` relative to UTC at a given instant (ms) — DST-safe via Intl
function tzOffsetMs(dateMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(dateMs)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUTC - Math.floor(dateMs / 1000) * 1000;
}

/**
 * Next RPD reset instant: the next moment local time in resetTz is rpdResetHour:00.
 * Europe-aware via Intl (handles DST). gemini resets 10:00 Europe, nvidia 00:00, etc.
 */
export function getRpdResetTime(rpdResetHour = 0, resetTz = DEFAULT_RESET_TZ) {
  const now = Date.now();
  const off = tzOffsetMs(now, resetTz); // local = utc + off
  const localNow = new Date(now + off);
  localNow.setUTCHours(0, 0, 0, 0); // local midnight as if UTC
  let resetUtc = localNow.getTime() - off + rpdResetHour * 3600000;
  if (resetUtc <= now) resetUtc += 24 * 3600000;
  return new Date(resetUtc);
}

export async function checkModelRateLimit(keyId, providerId, modelId, estimatedTokens = 0) {
  const limits = getModelRateLimits(providerId, modelId);
  return { allowed: true, limits };
}
