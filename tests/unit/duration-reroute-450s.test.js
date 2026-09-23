import { describe, it, expect, vi } from "vitest";
import { createReroutableStream, createStreamController } from "open-sse/utils/streamHandler.js";

describe("Reroutable Stream & 450s Auto-Reroute", () => {
  it("switches to alternative stream when timeout is reached without closing downstream stream", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Stuck initial stream that never ends and emits slow chunks
    const initialStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("chunk1 "));
      }
    });

    const streamController = createStreamController({
      provider: "test-provider",
      model: "stuck-model",
    });

    let rerouteCalled = false;
    const onReroute = vi.fn(async () => {
      rerouteCalled = true;
      // Alternative fallback stream
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("rerouted chunk2 [DONE]"));
          controller.close();
        }
      });
    });

    // Use a small 50ms maxDuration for the test
    const reroutable = createReroutableStream({
      initialStream,
      streamController,
      requestStartTime: Date.now(),
      maxDurationMs: 50,
      onReroute,
      provider: "test-provider",
      model: "stuck-model",
    });

    const reader = reroutable.getReader();
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value);
    }

    expect(accumulated).toContain("chunk1 ");
    expect(accumulated).toContain("rerouted chunk2 [DONE]");
    expect(onReroute).toHaveBeenCalled();
  });
});
