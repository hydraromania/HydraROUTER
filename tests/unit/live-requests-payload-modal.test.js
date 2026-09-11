import { describe, it, expect } from "vitest";
import { trackRequestStart, getLiveRequestsSnapshot, clearLiveRequestsHistory } from "@/lib/liveRequestsTracker.js";

describe("liveRequestsTracker payload capture", () => {
  it("captures and sanitizes request body up to 64KB", () => {
    clearLiveRequestsHistory();
    const testBody = { messages: [{ role: "user", content: "hello world" }], temperature: 0.7 };
    const id = trackRequestStart({
      model: "test-model",
      provider: "test-provider",
      body: testBody,
    });
    const snapshot = getLiveRequestsSnapshot();
    const req = snapshot.active.find((r) => r.id === id);
    expect(req).toBeDefined();
    expect(req.payload).toBeDefined();
    expect(req.payload.messages[0].content).toBe("hello world");
    expect(req.payload.temperature).toBe(0.7);
  });
});
