import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  handleEmbeddingsCore: vi.fn(),
  saveRequestUsage: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async (provider) => ({
    apiKey: "test-key",
    connectionId: `conn-${provider}`,
    connectionName: `Connection ${provider}`,
  }),
  markAccountUnavailable: vi.fn().mockResolvedValue({ shouldFallback: true, cooldownMs: 1000 }),
  clearAccountError: vi.fn(),
  extractApiKey: () => "test-api-key",
  isValidApiKey: vi.fn().mockResolvedValue(true),
  isModelAllowedForApiKey: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async (modelStr) => {
    const slash = modelStr.indexOf("/");
    if (slash > 0) {
      return { provider: modelStr.slice(0, slash), model: modelStr.slice(slash + 1) };
    }
    return { provider: null, model: modelStr };
  },
  getComboModels: async (modelStr) => {
    if (modelStr === "Memory") {
      return [
        "nvidia/nvidia/nemotron-3-embed-1b",
        "openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free",
        "gemini/gemini-embedding-2",
        "gemini/gemini-embedding-001",
      ];
    }
    return null;
  },
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: mocks.saveRequestUsage,
  trackRequestStart: vi.fn().mockReturnValue("req-test"),
  trackRequestEnd: vi.fn(),
  trackRequestError: vi.fn(),
}));

vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({
  handleEmbeddingsCore: mocks.handleEmbeddingsCore,
}));

import { handleEmbeddings, reorderEmbeddingModels } from "../../src/sse/handlers/embeddings.js";

describe("Embedding Combo handling with request size and dimension adaptation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it("reorders models prioritizing larger context length for large input payloads", () => {
    const models = [
      "gemini/gemini-embedding-001",
      "openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free",
      "nvidia/nvidia/nemotron-3-embed-1b",
      "gemini/gemini-embedding-2",
    ];

    // 10k tokens payload (> 8k tokens)
    const largeInput = "x".repeat(40000);
    const ordered = reorderEmbeddingModels(models, largeInput);

    // Nemotron-3-embed-1b has 32k context, so it should be first
    expect(ordered[0]).toBe("nvidia/nvidia/nemotron-3-embed-1b");
  });

  it("prioritizes models matching requested dimensions", () => {
    const models = [
      "nvidia/nvidia/nemotron-3-embed-1b", // 2048 dim
      "gemini/gemini-embedding-001",      // 768 dim
    ];

    const ordered = reorderEmbeddingModels(models, "short text", 768);
    expect(ordered[0]).toBe("gemini/gemini-embedding-001");
  });

  it("executes combo request and handles fallback when first model fails", async () => {
    const attemptedModels = [];

    mocks.handleEmbeddingsCore.mockImplementation(async ({ modelInfo }) => {
      attemptedModels.push(`${modelInfo.provider}/${modelInfo.model}`);
      if (attemptedModels.length === 1) {
        // First model fails (e.g. 429 rate limit or size error)
        return {
          success: false,
          status: 429,
          error: "Rate limit exceeded",
          response: Response.json({ error: "Rate limit" }, { status: 429 }),
        };
      }
      // Second model succeeds
      return {
        success: true,
        usage: { prompt_tokens: 10, total_tokens: 10 },
        response: Response.json({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3, 0.4] }],
          model: modelInfo.model,
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      };
    });

    const response = await handleEmbeddings(new Request("http://localhost/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "Memory",
        input: "test query",
      }),
    }));

    expect(response.status).toBe(200);
    expect(attemptedModels.length).toBe(2);
    const data = await response.json();
    expect(data.object).toBe("list");
    expect(data.data[0].embedding.length).toBe(4);
  });

  it("adapts output embedding dimensionality when requested dimensions is smaller than model output", async () => {
    mocks.handleEmbeddingsCore.mockResolvedValue({
      success: true,
      usage: { prompt_tokens: 5, total_tokens: 5 },
      response: Response.json({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.5, 0.5, 0.5, 0.5] }],
        model: "nvidia/nemotron-3-embed-1b",
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }),
    });

    const response = await handleEmbeddings(new Request("http://localhost/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "Memory",
        input: "test query",
        dimensions: 2,
      }),
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data[0].embedding.length).toBe(2);
    // Verifies L2 normalized: 0.7071^2 + 0.7071^2 ≈ 1
    const [x, y] = data.data[0].embedding;
    expect(Math.round((x * x + y * y) * 1000) / 1000).toBe(1);
  });
});
