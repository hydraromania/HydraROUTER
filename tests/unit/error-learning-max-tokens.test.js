import { describe, it, expect } from "vitest";
import { detectAndLearnError, tryAutoCorrect } from "../../open-sse/utils/errorLearning.js";

describe("errorLearning auto-correct for opencode / max_output_tokens", () => {
  it("detects max_output_tokens error from opencode response", () => {
    const errorMsg = 'Error from provider (Console): Upstream request failed: [invalid_request_error] `max_output_tokens` The number must be `>= 16`.';
    const learned = detectAndLearnError("opencode", "muse-spark-1.3-contributor-free", errorMsg, "openai");

    expect(learned).not.toBeNull();
    expect(learned.pattern).toBe("openai_max_tokens");
    expect(learned.autoCorrect).toBe("reduceMaxTokens");
  });

  it("auto-corrects max_output_tokens below 16 up to minimum allowed 16", () => {
    const body = { max_output_tokens: 1, messages: [{ role: "user", content: "ping" }] };
    const { body: correctedBody, corrected } = tryAutoCorrect(body, "openai", "reduceMaxTokens");

    expect(corrected).toBe(true);
    expect(correctedBody.max_output_tokens).toBe(16);
  });
});
