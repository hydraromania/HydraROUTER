import { describe, it, expect } from "vitest";
import { diagnoseErrors } from "@/lib/errorAnalysis/diagnose.js";

describe("Error Analysis Diagnosis Engine", () => {
  it("identifies 429 rate limit patterns and recommends pacing or account rotation", () => {
    const errorLogs = [
      {
        id: "req-1",
        statusCode: 429,
        provider: "gemini",
        model: "gemini-2.5-flash",
        error: "RESOURCE_EXHAUSTED: Rate limit exceeded for quota 'GenerateRequestsPerMinute'",
        timestamp: new Date().toISOString(),
      },
      {
        id: "req-2",
        statusCode: 429,
        provider: "gemini",
        model: "gemini-2.5-flash",
        error: "429 Too Many Requests: Quota exceeded",
        timestamp: new Date().toISOString(),
      },
    ];

    const result = diagnoseErrors(errorLogs);
    expect(result.summary.total429).toBe(2);
    expect(result.summary.total410).toBe(0);
    expect(result.patterns.length).toBeGreaterThan(0);
    const rateLimitPattern = result.patterns.find((p) => p.type === "rate_limit");
    expect(rateLimitPattern).toBeDefined();
    expect(rateLimitPattern.recommendation).toBeDefined();
    expect(rateLimitPattern.provider).toBe("gemini");
  });

  it("identifies 410 model deprecated/gone and recommends model replacement", () => {
    const errorLogs = [
      {
        id: "req-3",
        statusCode: 410,
        provider: "openai",
        model: "gpt-3.5-turbo-0613",
        error: "The model `gpt-3.5-turbo-0613` has been shut down or is no longer available.",
        timestamp: new Date().toISOString(),
      },
    ];

    const result = diagnoseErrors(errorLogs);
    expect(result.summary.total410).toBe(1);
    const gonePattern = result.patterns.find((p) => p.type === "model_gone");
    expect(gonePattern).toBeDefined();
    expect(gonePattern.model).toBe("gpt-3.5-turbo-0613");
  });

  it("identifies tool incompatibility or thinking parameter rejections", () => {
    const errorLogs = [
      {
        id: "req-4",
        statusCode: 400,
        provider: "gemini",
        model: "gemini-2.5-flash",
        error: "Thinking is not supported for this model or quota tier",
        timestamp: new Date().toISOString(),
      },
      {
        id: "req-5",
        statusCode: 400,
        provider: "gemini",
        model: "gemini-2.5-flash",
        error: "Tools/Function calling is not supported in the free tier for this region",
        timestamp: new Date().toISOString(),
      }
    ];

    const result = diagnoseErrors(errorLogs);
    const thinkingPattern = result.patterns.find((p) => p.type === "thinking_unsupported");
    const toolsPattern = result.patterns.find((p) => p.type === "tools_unsupported");
    expect(thinkingPattern).toBeDefined();
    expect(toolsPattern).toBeDefined();
  });
});
