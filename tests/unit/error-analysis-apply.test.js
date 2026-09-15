import { describe, it, expect } from "vitest";
import { buildFixPlan, FIX_ACTIONS } from "@/lib/errorAnalysis/applyFix.js";

describe("Error Analysis apply fixes", () => {
  it("enable_pacing persists ratePacing + round-robin strategy", () => {
    const plan = buildFixPlan({ action: "enable_pacing", provider: "gemini", settings: {} });
    expect(plan.settingsPatch.ratePacing.gemini.enabled).toBe(true);
    expect(plan.settingsPatch.providerStrategies.gemini.fallbackStrategy).toBe("round-robin");
  });

  it("replace_model returns a disable plan for the failing model", () => {
    const plan = buildFixPlan({ action: "replace_model", provider: "openai", model: "gpt-3.5-turbo-0613", settings: {} });
    expect(plan.disable.ids).toContain("gpt-3.5-turbo-0613");
  });

  it("disable_thinking picks a mode supported by the registry", () => {
    const off = buildFixPlan({ action: "disable_thinking", provider: "x", settings: {}, thinkingOptions: ["auto", "on", "off"] });
    expect(off.settingsPatch.providerThinking.x.mode).toBe("off");
    const none = buildFixPlan({ action: "disable_thinking", provider: "y", settings: {}, thinkingOptions: ["auto", "none", "low"] });
    expect(none.settingsPatch.providerThinking.y.mode).toBe("none");
  });

  it("drop_tools flags the provider and enable_rtk turns RTK on", () => {
    expect(buildFixPlan({ action: "drop_tools", provider: "gemini", settings: {} }).settingsPatch.toolStripProviders.gemini).toBe(true);
    expect(buildFixPlan({ action: "enable_rtk", provider: "gemini", settings: { rtkEnabled: false } }).settingsPatch.rtkEnabled).toBe(true);
  });

  it("rejects unknown actions and missing provider", () => {
    expect(buildFixPlan({ action: "nope", provider: "gemini", settings: {} })).toBeNull();
    expect(buildFixPlan({ action: FIX_ACTIONS[0], provider: "", settings: {} })).toBeNull();
  });
});
