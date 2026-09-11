import { describe, it, expect, beforeEach } from "vitest";
import { isModelAllowedForApiKey, filterModelsListForApiKey } from "@/lib/apiKeyModelFilter";
import * as db from "@/lib/localDb";

describe("API Key Model Access Control & Visibility", () => {
  let machineId = "test-machine-id";

  beforeEach(async () => {
    // Reset test database state if needed
  });

  it("allows all models if key has no restrictions (allowedModels = null or empty)", async () => {
    const key = await db.createApiKey("Unrestricted Key", machineId, null);
    expect(await isModelAllowedForApiKey(key.key, "openai/gpt-4o")).toBe(true);
    expect(await isModelAllowedForApiKey(key.key, "anthropic/claude-3-5-sonnet")).toBe(true);
    expect(await isModelAllowedForApiKey(key.key, "my-combo")).toBe(true);

    const catalog = [
      { id: "openai/gpt-4o" },
      { id: "anthropic/claude-3-5-sonnet" },
      { id: "my-combo" },
    ];
    const filtered = await filterModelsListForApiKey(catalog, key.key);
    expect(filtered).toHaveLength(3);
  });

  it("restricts access strictly to allowed models when specified", async () => {
    const key = await db.createApiKey("Restricted Key", machineId, [
      "openai/gpt-4o",
      "google/gemini-2.0-flash",
    ]);

    expect(await isModelAllowedForApiKey(key.key, "openai/gpt-4o")).toBe(true);
    expect(await isModelAllowedForApiKey(key.key, "google/gemini-2.0-flash")).toBe(true);
    expect(await isModelAllowedForApiKey(key.key, "anthropic/claude-3-5-sonnet")).toBe(false);

    const catalog = [
      { id: "openai/gpt-4o" },
      { id: "google/gemini-2.0-flash" },
      { id: "anthropic/claude-3-5-sonnet" },
    ];
    const filtered = await filterModelsListForApiKey(catalog, key.key);
    expect(filtered.map((m) => m.id)).toEqual([
      "openai/gpt-4o",
      "google/gemini-2.0-flash",
    ]);
  });

  it("handles combo permissions: combo is executable, children are executable but hidden from listing if not explicitly added", async () => {
    // Create a combo
    const combo = await db.createCombo({
      name: "smart-combo",
      models: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
    });

    // Key with access only to the combo
    const key = await db.createApiKey("Combo Key", machineId, ["smart-combo"]);

    // The combo itself is allowed
    expect(await isModelAllowedForApiKey(key.key, "smart-combo")).toBe(true);
    // The child models in the combo are executable via fallback/routing
    expect(await isModelAllowedForApiKey(key.key, "openai/gpt-4o")).toBe(true);
    expect(await isModelAllowedForApiKey(key.key, "anthropic/claude-3-5-sonnet")).toBe(true);
    // Unrelated model is NOT allowed
    expect(await isModelAllowedForApiKey(key.key, "deepseek/deepseek-chat")).toBe(false);

    // In model listing: ONLY "smart-combo" is returned! Child models are hidden unless directly added to allowedModels
    const catalog = [
      { id: "smart-combo" },
      { id: "openai/gpt-4o" },
      { id: "anthropic/claude-3-5-sonnet" },
      { id: "deepseek/deepseek-chat" },
    ];
    const filtered = await filterModelsListForApiKey(catalog, key.key);
    expect(filtered.map((m) => m.id)).toEqual(["smart-combo"]);

    // If key also explicitly has openai/gpt-4o added, both smart-combo and openai/gpt-4o show in list
    const key2 = await db.createApiKey("Combo Plus Model Key", machineId, ["smart-combo", "openai/gpt-4o"]);
    const filtered2 = await filterModelsListForApiKey(catalog, key2.key);
    expect(filtered2.map((m) => m.id)).toEqual(["smart-combo", "openai/gpt-4o"]);
  });

  it("updates allowedModels on existing key", async () => {
    const key = await db.createApiKey("To Update", machineId, ["openai/gpt-4o"]);
    expect(await isModelAllowedForApiKey(key.key, "anthropic/claude-3-5-sonnet")).toBe(false);

    await db.updateApiKey(key.id, {
      allowedModels: ["openai/gpt-4o", "anthropic/claude-3-5-sonnet"],
    });

    expect(await isModelAllowedForApiKey(key.key, "anthropic/claude-3-5-sonnet")).toBe(true);
  });
});
