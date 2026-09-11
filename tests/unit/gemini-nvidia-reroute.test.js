import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isGeminiReroutedToNvidia,
  recordGemini429Hit,
  recordGeminiSuccess,
  resetGeminiRerouteState,
  getGeminiRerouteStatus,
  isGeminiProvider,
  findNvidiaComboTarget,
} from "../../src/sse/services/geminiReroute.js";

vi.mock("@/lib/localDb", () => ({
  getCombos: vi.fn(async () => [
    { id: "1", name: "nVidia", models: ["nvidia/nemotron-3.5-lightning-30b-a3b"] },
    { id: "2", name: "fallback-combo", models: ["openai/gpt-4o"] },
  ]),
}));

describe("Gemini 7x 429 consecutive redirection to nVidia combo rule", () => {
  beforeEach(() => {
    resetGeminiRerouteState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetGeminiRerouteState();
    vi.useRealTimers();
  });

  it("identifies gemini and gemini-cli providers correctly", () => {
    expect(isGeminiProvider("gemini")).toBe(true);
    expect(isGeminiProvider("gemini-cli")).toBe(true);
    expect(isGeminiProvider("GEMINI")).toBe(true);
    expect(isGeminiProvider("openai")).toBe(false);
    expect(isGeminiProvider("nvidia")).toBe(false);
  });

  it("finds the nVidia combo target case-insensitively", async () => {
    const target = await findNvidiaComboTarget();
    expect(target).toBe("nVidia");
  });

  it("does not reroute when 429 count is less than 7", () => {
    for (let i = 1; i <= 6; i++) {
      const res = recordGemini429Hit(`model-${i}`, `key-${i}`);
      expect(res.rerouted).toBe(false);
      expect(isGeminiReroutedToNvidia()).toBe(false);
    }
  });

  it("reroutes to nVidia combo for 2 minutes after exactly 7 consecutive 429 errors", () => {
    // 6 consecutive 429s
    for (let i = 1; i <= 6; i++) {
      recordGemini429Hit(`model-${i}`, `key-${i}`);
    }
    expect(isGeminiReroutedToNvidia()).toBe(false);

    // 7th consecutive 429
    const res = recordGemini429Hit("model-7", "key-7");
    expect(res.rerouted).toBe(true);
    expect(isGeminiReroutedToNvidia()).toBe(true);

    const status = getGeminiRerouteStatus();
    expect(status.active).toBe(true);
    expect(status.remainingMs).toBeGreaterThan(0);
    expect(status.remainingMs).toBeLessThanOrEqual(2 * 60 * 1000);

    // After 1 minute, still rerouted
    vi.advanceTimersByTime(60 * 1000);
    expect(isGeminiReroutedToNvidia()).toBe(true);

    // After 2 minutes total, reroute expires
    vi.advanceTimersByTime(60 * 1000 + 10);
    expect(isGeminiReroutedToNvidia()).toBe(false);
  });

  it("resets strike counter when a successful request occurs", () => {
    // 5 consecutive 429s
    for (let i = 1; i <= 5; i++) {
      recordGemini429Hit(`model-${i}`, `key-${i}`);
    }
    expect(getGeminiRerouteStatus().consecutive429Count).toBe(5);

    // A success resets the counter
    recordGeminiSuccess();
    expect(getGeminiRerouteStatus().consecutive429Count).toBe(0);

    // Now another 3 429s will not trigger rerouting because count is 3, not 7
    for (let i = 1; i <= 3; i++) {
      recordGemini429Hit(`model-${i}`, `key-${i}`);
    }
    expect(isGeminiReroutedToNvidia()).toBe(false);
    expect(getGeminiRerouteStatus().consecutive429Count).toBe(3);
  });
});
