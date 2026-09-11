import { describe, it, expect } from "vitest";
import { RatePacer } from "../../open-sse/utils/ratePacer.js";

describe("RatePacer", () => {
  it("enforces minimum interval between concurrent acquisitions on the same key", async () => {
    const pacer = new RatePacer(100); // 100ms for fast testing
    const key = "gemini:proxy-1";

    const t0 = Date.now();
    const timestamps = [];

    await Promise.all([
      pacer.acquire(key).then(() => timestamps.push(Date.now() - t0)),
      pacer.acquire(key).then(() => timestamps.push(Date.now() - t0)),
      pacer.acquire(key).then(() => timestamps.push(Date.now() - t0)),
    ]);

    expect(timestamps.length).toBe(3);
    // 1st request resolves immediately (~0-20ms)
    // 2nd request resolves after >= 100ms
    // 3rd request resolves after >= 200ms
    expect(timestamps[0]).toBeLessThan(60);
    expect(timestamps[1]).toBeGreaterThanOrEqual(90);
    expect(timestamps[2]).toBeGreaterThanOrEqual(190);
  });

  it("allows different keys to execute concurrently without blocking each other", async () => {
    const pacer = new RatePacer(150);
    const t0 = Date.now();
    const timestamps = {};

    await Promise.all([
      pacer.acquire("gemini:conn-1").then(() => { timestamps.conn1 = Date.now() - t0; }),
      pacer.acquire("gemini:conn-2").then(() => { timestamps.conn2 = Date.now() - t0; }),
    ]);

    expect(timestamps.conn1).toBeLessThan(60);
    expect(timestamps.conn2).toBeLessThan(60);
  });
});
