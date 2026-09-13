import { DefaultExecutor } from "./default.js";

/**
 * NvidiaExecutor — handles requests to NVIDIA NIM (https://integrate.api.nvidia.com/v1)
 *
 * Models on NVIDIA NIM use OpenAI-compatible chat completions with specific conventions:
 * - Nemotron & Gemma models control thinking via chat_template_kwargs: { "enable_thinking": boolean }
 *   and optional reasoning_budget (integer token limit).
 * - DeepSeek models support chat_template_kwargs: { "thinking": boolean, "reasoning_effort": "low"|"high"|"max" }
 *   and top-level reasoning_effort.
 * - Poolside Laguna models support reasoning and chat_template_kwargs.
 * - Unpacks extra_body (common when clients use OpenAI Python SDK extra_body={...}) so parameters
 *   are preserved at top-level on the wire.
 * - Recommends temperature=1.0 and top_p=0.95 across NVIDIA NIM models if client does not specify.
 */
export class NvidiaExecutor extends DefaultExecutor {
  constructor() {
    super("nvidia");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    // Unpack extra_body if provided by OpenAI Python SDK or similar clients
    if (transformed.extra_body && typeof transformed.extra_body === "object") {
      const extra = transformed.extra_body;
      if (extra.chat_template_kwargs && typeof extra.chat_template_kwargs === "object") {
        transformed.chat_template_kwargs = {
          ...(transformed.chat_template_kwargs || {}),
          ...extra.chat_template_kwargs,
        };
      }
      if (extra.reasoning_budget !== undefined && transformed.reasoning_budget === undefined) {
        transformed.reasoning_budget = extra.reasoning_budget;
      }
    }

    const rawModel = typeof model === "string" ? model : (transformed.model || "");
    const cleanModel = rawModel.toLowerCase();
    const isNemotron = cleanModel.includes("nemotron");
    const isDeepSeek = cleanModel.includes("deepseek");
    const isGemma = cleanModel.includes("gemma");
    const isLaguna = cleanModel.includes("laguna");

    const eff = transformed.reasoning_effort;
    const isNone = eff === "none" || eff === "off";

    if (isNemotron) {
      transformed.chat_template_kwargs = transformed.chat_template_kwargs || {};
      if (transformed.chat_template_kwargs.enable_thinking === undefined) {
        if (isNone) {
          transformed.chat_template_kwargs.enable_thinking = false;
        } else if (eff) {
          transformed.chat_template_kwargs.enable_thinking = true;
        }
      }
      if (eff && !isNone && transformed.reasoning_budget === undefined) {
        if (eff === "low") transformed.reasoning_budget = 4096;
        else if (eff === "medium") transformed.reasoning_budget = 8192;
        else if (eff === "max" || eff === "xhigh") transformed.reasoning_budget = 32768;
        else transformed.reasoning_budget = 16384;
      }
      // Clean top-level reasoning_effort as Nemotron expects chat_template_kwargs
      delete transformed.reasoning_effort;
    } else if (isGemma) {
      transformed.chat_template_kwargs = transformed.chat_template_kwargs || {};
      if (transformed.chat_template_kwargs.enable_thinking === undefined) {
        if (isNone) {
          transformed.chat_template_kwargs.enable_thinking = false;
        } else if (eff) {
          transformed.chat_template_kwargs.enable_thinking = true;
        }
      }
      delete transformed.reasoning_effort;
    } else if (isDeepSeek) {
      transformed.chat_template_kwargs = transformed.chat_template_kwargs || {};
      if (transformed.chat_template_kwargs.thinking === undefined) {
        if (isNone) {
          transformed.chat_template_kwargs.thinking = false;
          delete transformed.reasoning_effort;
        } else if (eff) {
          const dsEff = (eff === "xhigh" || eff === "max") ? "max" : (eff === "low" ? "low" : "high");
          transformed.chat_template_kwargs.thinking = true;
          transformed.chat_template_kwargs.reasoning_effort = dsEff;
          transformed.reasoning_effort = dsEff;
        }
      }
    } else if (isLaguna) {
      if (isNone) {
        delete transformed.reasoning_effort;
      }
    }

    // Default recommended parameters for NVIDIA NIM models when not explicitly provided
    if (transformed.temperature === undefined) {
      transformed.temperature = 1;
    }
    if (transformed.top_p === undefined) {
      transformed.top_p = 0.95;
    }

    return transformed;
  }
}

export default NvidiaExecutor;
