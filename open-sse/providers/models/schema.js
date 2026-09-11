import { deriveModelName } from "./namePatterns.js";

// Normalize version separators in a model id: hyphen between two digits becomes a dot.
// Registry ids use dots for versions ("claude-sonnet-4.5") but clients (CLIs, aliases)
// often send them with dashes ("claude-sonnet-4-5"). Only digit-digit hyphens are
// touched, so word/suffix hyphens stay intact ("-thinking", "-agentic", "qwen3-coder-next").
export function normalizeModelId(modelId) {
  if (typeof modelId !== "string") return modelId;
  return modelId.replace(/(\d)-(\d)/g, "$1.$2");
}

// Model defaults centralized (was scattered as `m.kind || "llm"`, `quotaFamily || "normal"`, etc.)
export const MODEL_DEFAULTS = {
  kind: "llm",
  quotaFamily: "normal",
  strip: [],
  targetFormat: null
};

// Normalize a registry model entry: accept terse "id" string, fill name via regex when omitted.
// Override always wins (raw spread last); name falls back to regex → id.
export function normalizeModel(raw) {
  const model = typeof raw === "string" ? { id: raw } : raw;
  if (model.name !== undefined) return model;
  return { ...model, name: deriveModelName(model.id) };
}

// Resolve model kind with default (accepts legacy `type` field)
export function modelKind(model) {
  return model?.kind || model?.type || MODEL_DEFAULTS.kind;
}
export function modelQuotaFamily(model) {
  return model?.quotaFamily || MODEL_DEFAULTS.quotaFamily;
}
export function modelStrip(model) {
  return model?.strip || [];
}
export function modelTargetFormat(model) {
  return model?.targetFormat || MODEL_DEFAULTS.targetFormat;
}

// Per-model declared upstream formats (e.g. ["openai", "claude"]). Guards the
// sourceFormat-matched transport for multi-endpoint providers whose models differ
// in endpoint support (opencode-go: kimi/glm only do /chat/completions, minimax/qwen
// also do /messages, deepseek also does /responses).
export function modelSupportedFormats(model) {
  return model?.supportedFormats || null;
}

// Get model context length (input + output tokens)
export function modelContextLength(model) {
  return model?.contextLength || model?.maxContext || model?.maxTokens || 32768;
}

/**
 * Find models in a combo that can handle the given token count
 * Returns filtered models sorted by context length (smallest sufficient first)
 */
export function filterModelsByContext(models, providerModels, estimatedTokens) {
  if (!Array.isArray(models) || models.length === 0) return models;
  
  const withContext = models.map(modelStr => {
    const slashIndex = modelStr.indexOf("/");
    if (slashIndex === -1) return { modelStr, contextLength: Infinity }; // Unknown provider, assume OK
    
    const provider = modelStr.slice(0, slashIndex);
    const modelId = modelStr.slice(slashIndex + 1);
    const providerModelsList = providerModels[provider] || [];
    const modelDef = providerModelsList.find(m => m.id === modelId);
    const contextLength = modelContextLength(modelDef);
    return { modelStr, contextLength };
  });
  
  // Filter models that can handle the request
  const sufficient = withContext.filter(m => m.contextLength >= estimatedTokens);
  
  if (sufficient.length === 0) {
    // No model has enough context, return all sorted by context length (largest first)
    return withContext.sort((a, b) => b.contextLength - a.contextLength).map(m => m.modelStr);
  }
  
  // Return sufficient models, sorted by context length (smallest sufficient first for efficiency)
  return sufficient.sort((a, b) => a.contextLength - b.contextLength).map(m => m.modelStr);
}
