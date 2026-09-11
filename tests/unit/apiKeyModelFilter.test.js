import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetApiKeyByKey = vi.fn();
const mockGetCombos = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getApiKeyByKey: (...args) => mockGetApiKeyByKey(...args),
  getCombos: (...args) => mockGetCombos(...args),
}));

import { isModelAllowedForApiKey, filterModelsListForApiKey } from "../../src/lib/apiKeyModelFilter.js";

describe("apiKeyModelFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCombos.mockResolvedValue([
      {
        id: "combo-1",
        name: "my-combo",
        models: ["anthropic/claude-3-5-sonnet", "openai/gpt-4o"],
      },
      {
        id: "combo-2",
        name: "other-combo",
        models: ["deepseek/deepseek-chat"],
      },
    ]);
  });

  describe("isModelAllowedForApiKey", () => {
    it("allows everything if apiKey is null/empty", async () => {
      expect(await isModelAllowedForApiKey(null, "anthropic/claude-3-5-sonnet")).toBe(true);
      expect(await isModelAllowedForApiKey("", "openai/gpt-4o")).toBe(true);
    });

    it("rejects unknown apiKey", async () => {
      mockGetApiKeyByKey.mockResolvedValue(null);
      expect(await isModelAllowedForApiKey("sk-unknown", "anthropic/claude-3-5-sonnet")).toBe(false);
    });

    it("rejects inactive apiKey", async () => {
      mockGetApiKeyByKey.mockResolvedValue({ id: "1", key: "sk-test", isActive: false, allowedModels: null });
      expect(await isModelAllowedForApiKey("sk-test", "anthropic/claude-3-5-sonnet")).toBe(false);
    });

    it("allows all models if allowedModels is null or empty array", async () => {
      mockGetApiKeyByKey.mockResolvedValue({ id: "1", key: "sk-test", isActive: true, allowedModels: null });
      expect(await isModelAllowedForApiKey("sk-test", "anthropic/claude-3-5-sonnet")).toBe(true);

      mockGetApiKeyByKey.mockResolvedValue({ id: "1", key: "sk-test", isActive: true, allowedModels: [] });
      expect(await isModelAllowedForApiKey("sk-test", "anthropic/claude-3-5-sonnet")).toBe(true);
    });

    it("allows directly whitelisted model", async () => {
      mockGetApiKeyByKey.mockResolvedValue({
        id: "1",
        key: "sk-test",
        isActive: true,
        allowedModels: ["anthropic/claude-3-5-sonnet"],
      });
      expect(await isModelAllowedForApiKey("sk-test", "anthropic/claude-3-5-sonnet")).toBe(true);
      expect(await isModelAllowedForApiKey("sk-test", "openai/gpt-4o")).toBe(false);
    });

    it("allows model if it belongs to a whitelisted combo (combo functional)", async () => {
      mockGetApiKeyByKey.mockResolvedValue({
        id: "1",
        key: "sk-test",
        isActive: true,
        allowedModels: ["my-combo"],
      });
      // "my-combo" directly allowed
      expect(await isModelAllowedForApiKey("sk-test", "my-combo")).toBe(true);
      // models in my-combo are allowed for execution
      expect(await isModelAllowedForApiKey("sk-test", "anthropic/claude-3-5-sonnet")).toBe(true);
      expect(await isModelAllowedForApiKey("sk-test", "openai/gpt-4o")).toBe(true);
      // models not in my-combo are denied
      expect(await isModelAllowedForApiKey("sk-test", "deepseek/deepseek-chat")).toBe(false);
    });
  });

  describe("filterModelsListForApiKey", () => {
    const modelsCatalog = [
      { id: "my-combo", object: "model" },
      { id: "other-combo", object: "model" },
      { id: "anthropic/claude-3-5-sonnet", object: "model" },
      { id: "openai/gpt-4o", object: "model" },
      { id: "deepseek/deepseek-chat", object: "model" },
    ];

    it("returns entire catalog if apiKey is null or key has no allowedModels restrictions", async () => {
      expect(await filterModelsListForApiKey(modelsCatalog, null)).toEqual(modelsCatalog);

      mockGetApiKeyByKey.mockResolvedValue({ id: "1", key: "sk-test", isActive: true, allowedModels: null });
      expect(await filterModelsListForApiKey(modelsCatalog, "sk-test")).toEqual(modelsCatalog);
    });

    it("filters catalog to only explicitly whitelisted items, hiding combo children if not explicitly whitelisted", async () => {
      mockGetApiKeyByKey.mockResolvedValue({
        id: "1",
        key: "sk-test",
        isActive: true,
        allowedModels: ["my-combo"],
      });

      const filtered = await filterModelsListForApiKey(modelsCatalog, "sk-test");
      expect(filtered.map((m) => m.id)).toEqual(["my-combo"]);
    });

    it("includes combo children in listing ONLY if also explicitly whitelisted", async () => {
      mockGetApiKeyByKey.mockResolvedValue({
        id: "1",
        key: "sk-test",
        isActive: true,
        allowedModels: ["my-combo", "openai/gpt-4o"],
      });

      const filtered = await filterModelsListForApiKey(modelsCatalog, "sk-test");
      expect(filtered.map((m) => m.id)).toEqual(["my-combo", "openai/gpt-4o"]);
    });
  });
});
