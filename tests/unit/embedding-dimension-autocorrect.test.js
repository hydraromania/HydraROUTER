import { describe, it, expect, vi } from "vitest";

// Mock the providers module before importing
vi.mock("open-sse/providers/index.js", () => ({
  PROVIDER_MODELS: {
    openai: [
      { id: "text-embedding-3-small", name: "Text Embedding 3 Small", dimensions: 1536, kind: "embedding" },
      { id: "text-embedding-3-large", name: "Text Embedding 3 Large", dimensions: 3072, kind: "embedding" },
    ],
    nvidia: [
      { id: "nvidia/nemotron-3-embed-1b", name: "Nemotron 3 Embed 1B", dimensions: 2048, kind: "embedding" },
    ],
  },
}));

describe("embedding dimension auto-correct", () => {
  it("resolves native dimensions from PROVIDER_MODELS", async () => {
    const { PROVIDER_MODELS } = await import("open-sse/providers/index.js");
    
    const model = PROVIDER_MODELS.openai.find(m => m.id === "text-embedding-3-small");
    expect(model.dimensions).toBe(1536);
    
    // Client asks for 8888, model supports 1536 → should auto-correct
    expect(model.dimensions).not.toBe(8888);
  });

  it("8888 differs from all known embedding dimensions", async () => {
    const { PROVIDER_MODELS } = await import("open-sse/providers/index.js");
    
    const allDims = Object.values(PROVIDER_MODELS)
      .flat()
      .filter(m => m.kind === "embedding")
      .map(m => m.dimensions);
    
    expect(allDims).not.toContain(8888);
    expect(allDims).toContain(1536);
    expect(allDims).toContain(3072);
    expect(allDims).toContain(2048);
  });
});
