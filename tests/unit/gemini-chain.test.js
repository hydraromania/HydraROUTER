import { describe, expect, it } from "vitest";
import { GEMINI_FLASH_CHAIN, GEMINI_LITE_CHAIN, getGeminiChainFrom } from "../../open-sse/config/geminiChain.js";

describe("getGeminiChainFrom", () => {
  it("slices from requested model downward for Flash models", () => {
    expect(getGeminiChainFrom("gemini-3.8-flash")).toEqual(GEMINI_FLASH_CHAIN);
    expect(getGeminiChainFrom("gemini-3.7-flash")).toEqual(GEMINI_FLASH_CHAIN.slice(1));
    expect(getGeminiChainFrom("gemini-2.5-flash")).toEqual(["gemini-2.5-flash"]);
  });

  it("slices from requested model downward for Lite models", () => {
    expect(getGeminiChainFrom("gemini-3.5-flash-lite")).toEqual(GEMINI_LITE_CHAIN);
    expect(getGeminiChainFrom("gemini-3.1-flash-lite-preview")).toEqual(GEMINI_LITE_CHAIN.slice(1));
    expect(getGeminiChainFrom("gemini-2.5-flash-lite")).toEqual(["gemini-2.5-flash-lite"]);
  });

  it("unknown model falls back to full Flash or Lite chain depending on -lite tag", () => {
    expect(getGeminiChainFrom("nope")).toEqual(GEMINI_FLASH_CHAIN);
    expect(getGeminiChainFrom("custom-lite")).toEqual(GEMINI_LITE_CHAIN);
  });

  it("chain orders are correct", () => {
    expect(GEMINI_FLASH_CHAIN).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
    ]);
    expect(GEMINI_LITE_CHAIN).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-flash-lite",
    ]);
  });
});
