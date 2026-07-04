import { describe, expect, it, vi } from "vitest";

import { COWORKER_AGENT_ERROR_SNIPPET } from "../coworker-agent-error.js";
import { createCommitGateStream } from "./commit-gate-stream.js";

function partsStream(
  parts: Array<{ type: "text-delta"; delta: string } | { type: "finish" }>,
): ReadableStream<import("@ai-sdk/provider").LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(
          part as import("@ai-sdk/provider").LanguageModelV3StreamPart,
        );
      }
      controller.close();
    },
  });
}

async function collectText(
  stream: ReadableStream<import("@ai-sdk/provider").LanguageModelV3StreamPart>,
): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.type === "text-delta") {
      text += value.delta;
    }
  }
  return text;
}

describe("createCommitGateStream", () => {
  it("retries on agent-error before commit threshold", async () => {
    const onRetryNeeded = vi.fn(async () =>
      partsStream([
        { type: "text-delta", delta: "This is a complete coworker reply." },
        { type: "finish" },
      ]),
    );

    const stream = createCommitGateStream(
      partsStream([
        {
          type: "text-delta",
          delta: `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`,
        },
        { type: "finish" },
      ]),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("agent-error");
    expect(text).toBe("This is a complete coworker reply.");
  });

  it("retries on short-tail before commit threshold", async () => {
    const onRetryNeeded = vi.fn(async () =>
      partsStream([
        { type: "text-delta", delta: "This is a complete coworker reply." },
        { type: "finish" },
      ]),
    );

    const stream = createCommitGateStream(
      partsStream([{ type: "text-delta", delta: "Done" }, { type: "finish" }]),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("short-tail");
    expect(text).toBe("This is a complete coworker reply.");
  });

  it("commits and streams when output exceeds threshold without retry", async () => {
    const onRetryNeeded = vi.fn(async () => null);

    const stream = createCommitGateStream(
      partsStream([
        {
          type: "text-delta",
          delta: "This is a complete coworker reply with enough text.",
        },
        { type: "finish" },
      ]),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).not.toHaveBeenCalled();
    expect(text).toBe("This is a complete coworker reply with enough text.");
  });

  it("returns last attempt output when retry is exhausted", async () => {
    const onRetryNeeded = vi.fn(async () => null);

    const stream = createCommitGateStream(
      partsStream([
        {
          type: "text-delta",
          delta: `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`,
        },
        { type: "finish" },
      ]),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(text).toContain(COWORKER_AGENT_ERROR_SNIPPET);
  });
});
