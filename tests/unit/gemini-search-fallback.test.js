import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { handleChatSearch } from "../../open-sse/handlers/search/chatSearch.js";

const GEMINI_OK = {
  candidates: [
    {
      content: { parts: [{ text: "answer" }] },
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
      },
    },
  ],
  usageMetadata: { totalTokenCount: 42 },
};

const quotaErr = () => ({
  ok: false,
  status: 429,
  json: async () => ({ error: { message: "Quota exceeded for quota metric" } }),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gemini chat-search model fallback", () => {
  it("declares 2.5-flash default in registry", () => {
    const entry = REGISTRY.find((c) => c.id === "gemini");
    expect(entry.searchViaChat.defaultModel).toBe("gemini-2.5-flash");
    expect(entry.searchViaChat.fallbackModels).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
    ]);
  });

  it("retries next model on 429 and reports usedModel", async () => {
    const seen = [];
    vi.stubGlobal("fetch", async (url) => {
      const m = String(url).match(/models\/([^:]+):/)[1];
      seen.push(m);
      if (m !== "gemini-3.6-flash") return quotaErr();
      return { ok: true, status: 200, json: async () => GEMINI_OK };
    });
    const r = await handleChatSearch({
      provider: "gemini",
      query: "test",
      model: "gemini-3.8-flash",
      fallbackModels: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
      credentials: { apiKey: "k" },
      log: {},
    });
    expect(r.success).toBe(true);
    expect(r.usedModel).toBe("gemini-3.6-flash");
    expect(seen).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]);
    expect(r.data.answer.model).toBe("gemini-3.6-flash");
  });

  it("does not retry on non-quota errors", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return { ok: false, status: 400, json: async () => ({ error: { message: "Invalid argument" } }) };
    });
    const r = await handleChatSearch({
      provider: "gemini",
      query: "test",
      model: "gemini-3.8-flash",
      fallbackModels: ["gemini-3.7-flash"],
      credentials: { apiKey: "k" },
      log: {},
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("returns last error when every model is exhausted", async () => {
    vi.stubGlobal("fetch", async () => quotaErr());
    const r = await handleChatSearch({
      provider: "gemini",
      query: "test",
      model: "gemini-3.8-flash",
      fallbackModels: ["gemini-3.7-flash"],
      credentials: { apiKey: "k" },
      log: {},
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(429);
  });
});
