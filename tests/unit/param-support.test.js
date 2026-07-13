import { describe, it, expect } from "vitest";

import { stripUnsupportedParams, normalizeOpenAIParamNames } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("clamps VolcEngine Ark GLM max token fields to the model output ceiling", () => {
    const body = {
      max_tokens: 131072,
      max_completion_tokens: 131072,
      max_output_tokens: 131072,
    };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body).toEqual({
      max_tokens: 128000,
      max_completion_tokens: 128000,
      max_output_tokens: 128000,
    });
  });

  it("keeps VolcEngine Ark GLM max tokens when already under the ceiling", () => {
    const body = { max_tokens: 64000 };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body.max_tokens).toBe(64000);
  });
});

describe("normalizeOpenAIParamNames", () => {
  it("renames camelCase maxTokens to snake_case max_tokens", () => {
    const body = { model: "x", messages: [], maxTokens: 1024, temperature: 0.5 };

    normalizeOpenAIParamNames(body);

    expect(body.maxTokens).toBeUndefined();
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0.5);
  });

  it("does not clobber an existing snake_case value", () => {
    const body = { maxTokens: 1024, max_tokens: 2048 };

    normalizeOpenAIParamNames(body);

    expect(body.maxTokens).toBeUndefined();
    expect(body.max_tokens).toBe(2048);
  });

  it("renames all known camelCase OpenAI param aliases", () => {
    const body = {
      maxTokens: 1,
      maxCompletionTokens: 2,
      topP: 0.9,
      topK: 4,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      logitBias: { 5: -1 },
      responseFormat: { type: "json" },
      parallelToolCalls: false,
      toolChoice: "auto",
    };

    normalizeOpenAIParamNames(body);

    expect(body).toEqual({
      max_tokens: 1,
      max_completion_tokens: 2,
      top_p: 0.9,
      top_k: 4,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      logit_bias: { 5: -1 },
      response_format: { type: "json" },
      parallel_tool_calls: false,
      tool_choice: "auto",
    });
  });

  it("leaves bodies without camelCase params untouched", () => {
    const body = { max_tokens: 100, messages: [{ role: "user", content: "hi" }] };

    normalizeOpenAIParamNames(body);

    expect(body).toEqual({ max_tokens: 100, messages: [{ role: "user", content: "hi" }] });
  });
});
