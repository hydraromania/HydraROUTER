import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-auth-rotation-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderConnection, getProviderConnections } = await import("@/lib/localDb");
  const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");

  return {
    createProviderConnection,
    getProviderConnections,
    markAccountUnavailable,
    clearAccountError,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("auth model-lock and rotation rules", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("model-specific 429 error locks only the specific model and keeps testStatus as active", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;

    const conn = await ctx.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "test-key",
      name: "Test Connection 1",
      testStatus: "active"
    });

    const result = await ctx.markAccountUnavailable(conn.id, 429, "Rate limit exceeded", "openai", "gpt-4o");
    expect(result.shouldFallback).toBe(true);

    const connections = await ctx.getProviderConnections({ provider: "openai" });
    const updated = connections.find(c => c.id === conn.id);
    expect(updated).toBeDefined();
    expect(updated.testStatus).toBe("active");
    expect(updated["modelLock_gpt-4o"]).toBeDefined();
    expect(updated["modelLock___all"]).toBeUndefined();
  });

  it("global 401 error locks the entire connection and sets testStatus to unavailable", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;

    const conn = await ctx.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "test-key",
      name: "Test Connection 2",
      testStatus: "active"
    });

    const result = await ctx.markAccountUnavailable(conn.id, 401, "Unauthorized key", "openai", "gpt-4o");
    expect(result.shouldFallback).toBe(true);

    const connections = await ctx.getProviderConnections({ provider: "openai" });
    const updated = connections.find(c => c.id === conn.id);
    expect(updated).toBeDefined();
    expect(updated.testStatus).toBe("unavailable");
    expect(updated["modelLock___all"]).toBeDefined();
    expect(updated["modelLock_gpt-4o"]).toBeUndefined();
  });

  it("missing model locks the entire connection and sets testStatus to unavailable", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;

    const conn = await ctx.createProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "test-key",
      name: "Test Connection 3",
      testStatus: "active"
    });

    const result = await ctx.markAccountUnavailable(conn.id, 429, "Rate limit on account", "openai", null);
    expect(result.shouldFallback).toBe(true);

    const connections = await ctx.getProviderConnections({ provider: "openai" });
    const updated = connections.find(c => c.id === conn.id);
    expect(updated).toBeDefined();
    expect(updated.testStatus).toBe("unavailable");
    expect(updated["modelLock___all"]).toBeDefined();
  });
});
