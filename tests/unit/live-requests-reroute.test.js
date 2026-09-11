import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  trackRequestStart,
  trackRequestEnd,
  trackRequestError,
  registerLiveAbort,
  cancelLiveRequest,
  getLiveRequestsSnapshot,
  clearLiveRequestsHistory,
  getLiveRequestStuckTimeoutMs,
} from "../../src/lib/liveRequestsTracker.js";
import { blockModel, isModelBlocked, unblockModel } from "../../open-sse/services/combo.js";

describe("live requests cancel & reroute", () => {
  beforeEach(() => {
    clearLiveRequestsHistory();
    unblockModel("openai/gpt-4o");
  });

  it("registers abort callback and cancels active request", () => {
    let aborted = false;
    const reqId = trackRequestStart({
      model: "gpt-4o",
      provider: "openai",
      type: "chat",
    });

    registerLiveAbort(reqId, () => {
      aborted = true;
    });

    const result = cancelLiveRequest(reqId, { reason: "User cancelled" });
    expect(result.found).toBe(true);
    expect(aborted).toBe(true);

    // Simulate pipeline unwinding via trackRequestError
    trackRequestError(reqId, { error: "User cancelled", statusCode: 499 });

    const snap = getLiveRequestsSnapshot();
    expect(snap.active.find((r) => r.id === reqId)).toBeUndefined();
    const historyItem = snap.history.find((r) => r.id === reqId);
    expect(historyItem).toBeDefined();
    expect(historyItem.status).toBe("error");
    expect(historyItem.statusCode).toBe(499);
  });

  it("blocks model temporarily for reroute", () => {
    expect(isModelBlocked("openai/gpt-4o")).toBe(false);
    blockModel("openai/gpt-4o", 60000);
    expect(isModelBlocked("openai/gpt-4o")).toBe(true);
    unblockModel("openai/gpt-4o");
    expect(isModelBlocked("openai/gpt-4o")).toBe(false);
  });

  it("snapshot never leaks raw API keys and exposes the stuck budget", () => {
    const reqId = trackRequestStart({
      model: "gemini-2.5-flash",
      provider: "gemini",
      type: "chat",
      apiKey: "sk-secret-key-1234567890",
    });
    trackRequestEnd(reqId, {
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      statusCode: 200,
    });

    const snap = getLiveRequestsSnapshot();
    expect(snap.stuckTimeoutMs).toBe(getLiveRequestStuckTimeoutMs());
    for (const item of [...snap.active, ...snap.history]) {
      expect(item).not.toHaveProperty("rawApiKey");
    }
    const done = snap.history.find((r) => r.id === reqId);
    expect(done).toBeDefined();
    expect(done.status).toBe("completed");
    expect(done.tokens.prompt).toBe(10);
    expect(done.tokens.completion).toBe(5);
    // Masked key is fine to expose, raw key is not.
    expect(done.apiKey).not.toContain("secret");
  });

  it("second end backfills tokens instead of dropping them", () => {
    const reqId = trackRequestStart({ model: "m", provider: "p", type: "chat" });
    trackRequestEnd(reqId, { statusCode: 200 });
    // Overlapping terminal path (e.g. premature end + token-carrying end):
    // tokens must land on the history row, not vanish.
    trackRequestEnd(reqId, {
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
      statusCode: 200,
    });
    const snap = getLiveRequestsSnapshot();
    const done = snap.history.find((r) => r.id === reqId);
    expect(done).toBeDefined();
    expect(done.tokens.prompt).toBe(7);
    expect(done.tokens.completion).toBe(3);
  });

  it("chatCore imports registerLiveAbort (no ReferenceError at runtime)", () => {
    // Regression: the dashboard abort wiring was called without being imported,
    // throwing on every chat request and leaving stuck ACTIVE rows behind.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.resolve(here, "../../open-sse/handlers/chatCore.js"),
      "utf8"
    );
    const uses = src.includes("registerLiveAbort(");
    expect(uses).toBe(true);
    const importLine = src
      .split("\n")
      .find((l) => l.startsWith("import") && l.includes("@/lib/usageDb.js"));
    expect(importLine).toBeDefined();
    expect(importLine).toContain("registerLiveAbort");
  });
});
