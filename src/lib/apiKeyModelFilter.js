import { getApiKeyByKey, getCombos } from "@/lib/localDb";

/**
 * Forced client-facing response format for an API key.
 * Dashboard sets per-key outputFormat: "auto" (detect from request) |
 * "openai" (always answer OpenAI shape) | "claude" (always answer Claude Message shape).
 * Returns the translator FORMATS value or null when auto/unset.
 */
export async function getResponseFormatOverrideForApiKey(apiKey) {
  if (!apiKey) return null;
  try {
    const keyRecord = await getApiKeyByKey(apiKey);
    const fmt = String(keyRecord?.outputFormat || "auto").toLowerCase();
    if (fmt === "claude") return "claude";
    if (fmt === "openai") return "openai";
  } catch { /* fail-open: auto-detect */ }
  return null;
}

/**
 * Check if a model/combo is allowed for a given API key.
 *
 * Rules:
 * - If apiKey is empty/null, all models are allowed (e.g. internal calls or requireApiKey=false).
 * - If the API key does not have allowedModels or allowedModels is null / empty array, all models are allowed.
 * - If allowedModels is configured:
 *   1. Direct match: allowedModels includes modelStr (e.g. "anthropic/claude-3-7-sonnet" or combo name "my-combo") -> allowed.
 *   2. Child of allowed combo: If allowedModels includes combo name "my-combo", any model inside "my-combo" is executable/allowed.
 *   3. If modelStr is not directly in allowedModels and not part of an allowed combo -> denied.
 *
 * @param {string|null} apiKey
 * @param {string} modelStr
 * @returns {Promise<boolean>}
 */
export async function isModelAllowedForApiKey(apiKey, modelStr) {
  if (!apiKey || !modelStr) return true;

  const keyRecord = await getApiKeyByKey(apiKey);
  if (!keyRecord) {
    // Unknown key -> return false
    return false;
  }
  if (keyRecord.isActive === false) return false;

  // Unrestricted key
  if (!keyRecord.allowedModels || !Array.isArray(keyRecord.allowedModels) || keyRecord.allowedModels.length === 0) {
    return true;
  }

  const allowedSet = new Set(keyRecord.allowedModels);
  if (allowedSet.has(modelStr)) return true;

  // Check combo children: if allowedModels contains a combo name, any model inside it is allowed
  const combos = await getCombos();
  for (const combo of combos) {
    if (allowedSet.has(combo.name)) {
      if (Array.isArray(combo.models) && combo.models.includes(modelStr)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter a list of models (OpenAI list format) for a given API key.
 *
 * Rules for listing:
 * - If apiKey is empty/null, return all models.
 * - If key has no allowedModels (or empty), return all models.
 * - If key has allowedModels:
 *   - Only include models/combos that are explicitly in allowedModels!
 *   - Note: Models that are only accessible because they belong to an allowed combo
 *     are intentionally HIDDEN from the list (unless explicitly added to allowedModels).
 *
 * @param {Array<object>} models - Array of model objects ({ id, object, ... })
 * @param {string|null} apiKey
 * @returns {Promise<Array<object>>}
 */
export async function filterModelsListForApiKey(models, apiKey) {
  if (!apiKey || !Array.isArray(models)) return models;

  const keyRecord = await getApiKeyByKey(apiKey);
  if (!keyRecord || !keyRecord.isActive) return models;

  if (!keyRecord.allowedModels || !Array.isArray(keyRecord.allowedModels) || keyRecord.allowedModels.length === 0) {
    return models;
  }

  const allowedSet = new Set(keyRecord.allowedModels);
  return models.filter((m) => m && m.id && allowedSet.has(m.id));
}
