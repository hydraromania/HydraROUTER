// OpenAI → Gemini / Cursor / CommandCode request translation.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const O2G = (body) => translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", body, true, null, "gemini");
const O2C = (body) => translateRequest(FORMATS.OPENAI, FORMATS.CURSOR, "m", body, true, null, "cursor");
const O2CC = (body) => translateRequest(FORMATS.OPENAI, FORMATS.COMMANDCODE, "m", body, true, null, "commandcode");

describe("OpenAI → Gemini", () => {
  // openai-to-gemini.js:92-96 — each system message overwrites systemInstruction → only last kept
  // KNOWN BUG
  it.fails("multiple system messages are all kept", () => {
    const out = O2G({
      messages: [
        { role: "system", content: "RULE_ONE" },
        { role: "system", content: "RULE_TWO" },
        { role: "user", content: "hi" },
      ],
    });
    expect(JSON.stringify(out.systemInstruction), "earlier system lost").toContain("RULE_ONE");
  });

  // normalizeGeminiContents — collapse adjacent same-role entries
  it("merges two adjacent user turns into one content entry", () => {
    const out = O2G({
      messages: [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ],
    });
    expect(out.contents).toHaveLength(1);
    expect(out.contents[0].role).toBe("user");
    const texts = out.contents[0].parts.map((p) => p.text);
    expect(texts).toEqual(["first", "second"]);
  });

  it("merges tool-result user entry with following user text entry", () => {
    const out = O2G({
      messages: [
        { role: "user", content: "calculate" },
        { role: "assistant", content: "", tool_calls: [
          { id: "call_1", type: "function", function: { name: "add", arguments: '{"a":1,"b":2}' } },
        ] },
        { role: "tool", tool_call_id: "call_1", content: "3" },
        { role: "user", content: "thanks" },
      ],
    });
    // Expect: user(calculate), model(functionCall), user(functionResponse + thanks)
    expect(out.contents).toHaveLength(3);
    expect(out.contents[0].role).toBe("user");
    expect(out.contents[1].role).toBe("model");
    expect(out.contents[2].role).toBe("user");
    // The merged user entry has functionResponse + text
    const lastUser = out.contents[2];
    const hasFuncResp = lastUser.parts.some((p) => p.functionResponse);
    const hasText = lastUser.parts.some((p) => p.text === "thanks");
    expect(hasFuncResp).toBe(true);
    expect(hasText).toBe(true);
  });

  it("leaves normal alternating conversation unchanged", () => {
    const out = O2G({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
        { role: "user", content: "how are you" },
      ],
    });
    expect(out.contents).toHaveLength(3);
    expect(out.contents[0].role).toBe("user");
    expect(out.contents[0].parts[0].text).toBe("hello");
    expect(out.contents[1].role).toBe("model");
    expect(out.contents[1].parts[0].text).toBe("hi there");
    expect(out.contents[2].role).toBe("user");
    expect(out.contents[2].parts[0].text).toBe("how are you");
  });
});

describe("OpenAI → Gemini sampling params (400 invalid argument)", () => {
  // Gemini 2.5 (gemini-budget) rejects topP/topK entirely and only accepts
  // temperature 0 or 1 — anything else → 400 "Request contains an invalid argument".
  it("gemini 2.5: drops topP/topK and clamps temperature to 0|1", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-flash", {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "gemini");
    expect(out.generationConfig.topP).toBeUndefined();
    expect(out.generationConfig.topK).toBeUndefined();
    expect(out.generationConfig.temperature).toBe(1);
  });

  it("gemini 2.5: keeps temperature 0 (deterministic) and drops topP/topK", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-flash", {
      temperature: 0,
      top_p: 0.9,
      top_k: 40,
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "gemini");
    expect(out.generationConfig.topP).toBeUndefined();
    expect(out.generationConfig.topK).toBeUndefined();
    expect(out.generationConfig.temperature).toBe(0);
  });

  // Gemini 3.x (gemini-level) deprecates all sampling params — drop them so
  // the model runs on its tuned defaults instead of a 400.
  it("gemini 3.x: drops temperature/topP/topK entirely", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-3.7-flash", {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "gemini");
    expect(out.generationConfig.temperature).toBeUndefined();
    expect(out.generationConfig.topP).toBeUndefined();
    expect(out.generationConfig.topK).toBeUndefined();
  });

  // Older Gemini models still accept sampling params — must not be touched.
  it("gemini 2.0: keeps temperature/topP/topK untouched", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.0-flash", {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "gemini");
    expect(out.generationConfig.temperature).toBe(0.7);
    expect(out.generationConfig.topP).toBe(0.9);
    expect(out.generationConfig.topK).toBe(40);
  });

  // HARM_CATEGORY_CIVIC_INTEGRITY was removed from the Gemini API enum —
  // sending it → 400. The default safety settings must not include it.
  it("default safety settings exclude removed CIVIC_INTEGRITY category", () => {
    const out = O2G({ messages: [{ role: "user", content: "hi" }] });
    const categories = out.safetySettings.map((s) => s.category);
    expect(categories).not.toContain("HARM_CATEGORY_CIVIC_INTEGRITY");
    expect(categories).toContain("HARM_CATEGORY_HATE_SPEECH");
  });
});

describe("OpenAI → Cursor", () => {
  // openai-to-cursor.js:12-24 — image content fully dropped (text only)
  // KNOWN BUG
  it.fails("image content is preserved", () => {
    const out = O2C({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ] }],
    });
    expect(JSON.stringify(out), "image dropped").toContain("AAAA");
  });

  // openai-to-cursor.js:179 — max_tokens hardcoded to 32000
  // KNOWN BUG
  it.fails("respects client max_tokens", () => {
    const out = O2C({ max_tokens: 200, messages: [{ role: "user", content: "hi" }] });
    expect(out.max_tokens).toBe(200);
  });
});

describe("OpenAI → CommandCode", () => {
  // openai-to-commandcode.js:53-57 — safeParseJson returns {} on bad JSON (args silently lost)
  // KNOWN BUG
  it.fails("malformed tool arguments are not silently emptied", () => {
    const out = O2CC({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "{bad" } },
        ] },
        { role: "tool", tool_call_id: "c1", content: "r" },
      ],
    });
    const asst = out.params.messages.find((m) => m.role === "assistant");
    const call = asst.content.find((b) => b.type === "tool-call");
    expect(Object.keys(call.input).length, "arguments silently dropped to {}").toBeGreaterThan(0);
  });

  // openai-to-commandcode.js:41-42 — image becomes "[image omitted]"
  // KNOWN BUG
  it.fails("image content is preserved", () => {
    const out = O2CC({
      messages: [{ role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
      ] }],
    });
    expect(JSON.stringify(out), "image omitted").toContain("BBBB");
  });
});
