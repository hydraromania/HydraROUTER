import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrarouter-ratelimit-test-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global.__hydrarouter_rateLimitTracker__;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global.__hydrarouter_rateLimitTracker__;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("RateLimitTracker - Manual Block vs 429 Cooldown", () => {
  it("recordManualBlock records manualBlockUntil and blocks requests with 'manually blocked' reason", async () => {
    const { rateLimitTracker } = await import("open-sse/services/rateLimitTracker.js");
    const { getRateLimit } = await import("@/lib/db/repos/rateLimitsRepo.js");

    const keyId = "conn_123";
    const modelId = "gemini-2.5-flash";
    const providerId = "gemini";

    const res = await rateLimitTracker.recordManualBlock(keyId, modelId, providerId);
    expect(res.manualBlockUntil).toBeGreaterThan(Date.now());

    // Verify DB persistence
    const dbRow = await getRateLimit(keyId, modelId, providerId);
    expect(dbRow).toBeTruthy();
    expect(dbRow.manualBlockUntil).toBe(res.manualBlockUntil);
    expect(dbRow.rateLimitedUntil).toBe(0);

    // Verify checkLimit returns reason: 'manually blocked'
    const check = await rateLimitTracker.checkLimit(keyId, modelId, providerId);
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe("manually blocked");

    // Verify isRateLimited returns true
    const isLimited = await rateLimitTracker.isRateLimited(keyId, modelId, providerId);
    expect(isLimited).toBe(true);

    // Verify getAllKeysUsage includes manualBlockUntil
    const allUsage = await rateLimitTracker.getAllKeysUsage(modelId, providerId);
    const keyUsage = allUsage.find((u) => u.keyId === keyId);
    expect(keyUsage).toBeTruthy();
    expect(keyUsage.manualBlockUntil).toBe(res.manualBlockUntil);
    expect(keyUsage.rateLimitedUntil).toBe(0);
  });

  it("recordRateLimitHit records rateLimitedUntil and blocks requests with '429 cooldown' reason", async () => {
    const { rateLimitTracker } = await import("open-sse/services/rateLimitTracker.js");
    const { getRateLimit } = await import("@/lib/db/repos/rateLimitsRepo.js");

    const keyId = "conn_456";
    const modelId = "gemini-2.5-flash";
    const providerId = "gemini";

    const res = await rateLimitTracker.recordRateLimitHit(keyId, modelId, providerId);
    expect(res.rateLimitedUntil).toBeGreaterThan(Date.now());

    // Verify DB persistence
    const dbRow = await getRateLimit(keyId, modelId, providerId);
    expect(dbRow).toBeTruthy();
    expect(dbRow.rateLimitedUntil).toBe(res.rateLimitedUntil);
    expect(dbRow.manualBlockUntil).toBe(0);

    // Verify checkLimit returns reason: '429 cooldown'
    const check = await rateLimitTracker.checkLimit(keyId, modelId, providerId);
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe("429 cooldown");
  });

  it("clearManualBlock clears manualBlockUntil in memory and DB", async () => {
    const { rateLimitTracker } = await import("open-sse/services/rateLimitTracker.js");
    const { getRateLimit } = await import("@/lib/db/repos/rateLimitsRepo.js");

    const keyId = "conn_789";
    const modelId = "gemini-2.5-flash";
    const providerId = "gemini";

    await rateLimitTracker.recordManualBlock(keyId, modelId, providerId);
    let check = await rateLimitTracker.checkLimit(keyId, modelId, providerId);
    expect(check.allowed).toBe(false);

    await rateLimitTracker.clearManualBlock(keyId, modelId, providerId);

    const dbRow = await getRateLimit(keyId, modelId, providerId);
    expect(dbRow.manualBlockUntil).toBe(0);

    check = await rateLimitTracker.checkLimit(keyId, modelId, providerId);
    expect(check.allowed).toBe(true);
  });
});
