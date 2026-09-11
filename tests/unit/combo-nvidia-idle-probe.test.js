import { describe, it, expect, afterEach } from "vitest";

import {
  handleComboChat,
  isModelBlocked,
  unblockModel,
  recordModelSuccess,
  isNvidiaModel,
  needsIdleProbe,
  buildIdleProbeBody,
  NVIDIA_PROBE_BLOCK_MS,
} from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {} };
const realBody = { messages: [{ role: "user", content: "real user data" }] };
const isProbe = (body) => body?.messages?.[0]?.content === "ping";

function failRes() {
  return { ok: false, status: 503, statusText: "Service Unavailable", clone: () => ({ json: async () => ({}) }) };
}

afterEach(() => {
  for (const m of ["nvidia/probe-miss-x1", "nvidia/probe-next-x1", "nvidia/probe-hit-x2", "nvidia/probe-next-x2"]) {
    unblockModel(m);
  }
});

describe("nvidia idle probe", () => {
  it("detects nvidia models only", () => {
    expect(isNvidiaModel("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(true);
    expect(isNvidiaModel("NVIDIA/kimi-k3")).toBe(true);
    expect(isNvidiaModel("openai/gpt-4o")).toBe(false);
    expect(isNvidiaModel(null)).toBe(false);
  });

  it("unknown (never used) counts as idle, recent success does not", () => {
    expect(needsIdleProbe("nvidia/probe-unknown-zzz")).toBe(true);
    expect(needsIdleProbe("openai/gpt-4o")).toBe(false);
    recordModelSuccess("nvidia/probe-fresh-zzz");
    expect(needsIdleProbe("nvidia/probe-fresh-zzz")).toBe(false);
  });

  it("probe body is synthetic: ping only, no tools, non-streaming", () => {
    const probe = buildIdleProbeBody({
      messages: [{ role: "user", content: "secret user data" }],
      stream: true,
      tools: [{ type: "function" }],
      tool_choice: "auto",
    });
    expect(probe.stream).toBe(false);
    expect(probe.max_tokens).toBe(1);
    expect(probe.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(probe).not.toHaveProperty("tools");
    expect(probe).not.toHaveProperty("tool_choice");
  });

  it("probe miss: real payload never sent to dead model, next tried, 1h block", async () => {
    const seen = [];
    const handleSingleModel = async (body, model) => {
      seen.push({ model, probe: isProbe(body) });
      if (model === "nvidia/probe-miss-x1") return failRes();
      return { ok: true, status: 200 };
    };
    const res = await handleComboChat({
      body: realBody,
      models: ["nvidia/probe-miss-x1", "nvidia/probe-next-x1"],
      handleSingleModel,
      log,
      comboName: "nvidia-probe-test",
    });
    expect(res.ok).toBe(true);
    expect(seen.find((s) => s.model === "nvidia/probe-miss-x1" && !s.probe)).toBeUndefined();
    expect(seen.find((s) => s.model === "nvidia/probe-next-x1" && !s.probe)).toBeDefined();
    expect(isModelBlocked("nvidia/probe-miss-x1")).toBe(true);
    expect(NVIDIA_PROBE_BLOCK_MS).toBe(60 * 60 * 1000);
  });

  it("probe hit: real payload follows the synthetic ping on same model", async () => {
    const seen = [];
    const handleSingleModel = async (body, model) => {
      seen.push({ model, probe: isProbe(body) });
      return { ok: true, status: 200 };
    };
    const res = await handleComboChat({
      body: realBody,
      models: ["nvidia/probe-hit-x2", "nvidia/probe-next-x2"],
      handleSingleModel,
      log,
      comboName: "nvidia-probe-test-hit",
    });
    expect(res.ok).toBe(true);
    const first = seen.filter((s) => s.model === "nvidia/probe-hit-x2");
    expect(first.map((s) => s.probe)).toEqual([true, false]);
  });
});
