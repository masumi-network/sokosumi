import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import {
  COWORKER_AGENT_ERROR_MARKER,
  COWORKER_AGENT_ERROR_SNIPPET,
  MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
} from "../coworker-agent-error.js";
import { createCommitGateStream } from "./commit-gate-stream.js";

type TestPart =
  | { type: "stream-start"; warnings: [] }
  | { type: "response-metadata"; id: string }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: string;
    }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | { type: "finish" };

const COMPLETE_REPLY = "This is a complete coworker reply.";
const COMPLETE_REPLY_LONG =
  "This is a complete coworker reply with enough text.";

function asPart(part: TestPart): LanguageModelV4StreamPart {
  return part as LanguageModelV4StreamPart;
}

function partsStream(
  parts: TestPart[],
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(asPart(part));
      }
      controller.close();
    },
  });
}

function completeReplyParts(text: string = COMPLETE_REPLY): TestPart[] {
  return [{ type: "text-delta", delta: text }, { type: "finish" }];
}

function agentErrorTextParts(
  delta: string = `${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`,
): TestPart[] {
  return [{ type: "text-delta", delta }, { type: "finish" }];
}

function agentErrorWithReasoningSourceParts(): TestPart[] {
  return [
    { type: "reasoning-start", id: "rs_err" },
    {
      type: "reasoning-delta",
      id: "rs_err",
      delta: "Something went wrong…",
    },
    { type: "reasoning-end", id: "rs_err" },
    ...agentErrorTextParts(),
  ];
}

function failedAttemptWithSetupParts(extra: TestPart[] = []): TestPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "resp_fail" },
    ...extra,
    ...agentErrorTextParts(),
  ];
}

function retrySuccessWithSetupStream(
  text: string = COMPLETE_REPLY_LONG,
): ReadableStream<LanguageModelV4StreamPart> {
  return partsStream([
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "resp_retry" },
    ...completeReplyParts(text),
  ]);
}

function completeReplyStream(
  text: string = COMPLETE_REPLY,
): ReadableStream<LanguageModelV4StreamPart> {
  return partsStream(completeReplyParts(text));
}

async function collectText(
  stream: ReadableStream<LanguageModelV4StreamPart>,
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

async function collectTypes(
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<string[]> {
  const parts = await collectParts(stream);
  return parts.map((part) => part.type);
}

async function collectParts(
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<LanguageModelV4StreamPart[]> {
  const reader = stream.getReader();
  const parts: LanguageModelV4StreamPart[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(value);
  }
  return parts;
}

describe("createCommitGateStream", () => {
  it("retries on agent-error before commit threshold", async () => {
    const onRetryNeeded = vi.fn(async () => completeReplyStream());

    const stream = createCommitGateStream(partsStream(agentErrorTextParts()), {
      onRetryNeeded,
    });

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("agent-error");
    expect(text).toBe(COMPLETE_REPLY);
  });

  it("retries on AGENT_ERROR marker the same as full agent-error snippet", async () => {
    const onRetryNeeded = vi.fn(async () => completeReplyStream());

    const stream = createCommitGateStream(
      partsStream(
        agentErrorTextParts(`Prefix ${COWORKER_AGENT_ERROR_MARKER} suffix`),
      ),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("agent-error");
    expect(text).toBe(COMPLETE_REPLY);
  });

  it("retries on short-tail before commit threshold", async () => {
    const onRetryNeeded = vi.fn(async () => completeReplyStream());

    const stream = createCommitGateStream(
      partsStream([{ type: "text-delta", delta: "Done" }, { type: "finish" }]),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("short-tail");
    expect(text).toBe(COMPLETE_REPLY);
  });

  it("commits and streams when output exceeds threshold without retry", async () => {
    const onRetryNeeded = vi.fn(async () => null);

    const stream = createCommitGateStream(
      partsStream(completeReplyParts(COMPLETE_REPLY_LONG)),
      { onRetryNeeded },
    );

    const text = await collectText(stream);
    expect(onRetryNeeded).not.toHaveBeenCalled();
    expect(text).toBe(COMPLETE_REPLY_LONG);
  });

  it("returns last attempt output when retry is exhausted", async () => {
    const onRetryNeeded = vi.fn(async () => null);

    const stream = createCommitGateStream(partsStream(agentErrorTextParts()), {
      onRetryNeeded,
    });

    const text = await collectText(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(text).toContain(COWORKER_AGENT_ERROR_SNIPPET);
  });

  it("forwards reasoning progress before answer text commits", async () => {
    let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
    const source = new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        sourceController = controller;
      },
    });

    const onRetryNeeded = vi.fn(async () => null);
    const gated = createCommitGateStream(source, {
      onRetryNeeded,
      minGoodChars: MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS,
    });
    const reader = gated.getReader();

    sourceController.enqueue(
      asPart({ type: "reasoning-start", id: "rs_progress" }),
    );
    sourceController.enqueue(
      asPart({
        type: "reasoning-delta",
        id: "rs_progress",
        delta: "Running tool work…",
      }),
    );
    sourceController.enqueue(
      asPart({ type: "reasoning-end", id: "rs_progress" }),
    );

    // Reasoning must leave the gate before any answer text is enqueued.
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "reasoning-start", id: "rs_progress" },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: {
        type: "reasoning-delta",
        id: "rs_progress",
        delta: "Running tool work…",
      },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "reasoning-end", id: "rs_progress" },
    });

    // Short text stays gated; only commit-threshold text unblocks the buffer.
    const shortText = "Hi";
    const commitText = "x".repeat(MIN_GOOD_COWORKER_OUTPUT_TEXT_CHARS);
    sourceController.enqueue(asPart({ type: "text-delta", delta: shortText }));
    sourceController.enqueue(asPart({ type: "text-delta", delta: commitText }));
    sourceController.enqueue(asPart({ type: "finish" }));
    sourceController.close();

    // Buffered short text flushes first, then the committing delta.
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "text-delta", delta: shortText },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "text-delta", delta: commitText },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "finish" },
    });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    expect(onRetryNeeded).not.toHaveBeenCalled();
  });

  it("forwards tool progress before answer text commits", async () => {
    let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
    const source = new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        sourceController = controller;
      },
    });

    const onRetryNeeded = vi.fn(async () => null);
    const gated = createCommitGateStream(source, { onRetryNeeded });
    const reader = gated.getReader();

    sourceController.enqueue(
      asPart({
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "list_jobs",
        input: "{}",
      }),
    );
    sourceController.enqueue(
      asPart({
        type: "tool-input-start",
        id: "call_1",
        toolName: "list_jobs",
      }),
    );
    sourceController.enqueue(
      asPart({ type: "tool-input-delta", id: "call_1", delta: '{"q":' }),
    );
    sourceController.enqueue(asPart({ type: "tool-input-end", id: "call_1" }));

    // Tool parts must leave the gate before any answer text is enqueued.
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "tool-call", toolCallId: "call_1" },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "tool-input-start", id: "call_1" },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "tool-input-delta", id: "call_1", delta: '{"q":' },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "tool-input-end", id: "call_1" },
    });

    sourceController.enqueue(
      asPart({ type: "text-delta", delta: COMPLETE_REPLY_LONG }),
    );
    sourceController.enqueue(asPart({ type: "finish" }));
    sourceController.close();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: {
        type: "text-delta",
        delta: COMPLETE_REPLY_LONG,
      },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "finish" },
    });
    expect(onRetryNeeded).not.toHaveBeenCalled();
  });

  it("holds setup until progress, flushing only stream-start with progress", async () => {
    let sourceController!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
    const source = new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        sourceController = controller;
      },
    });

    const gated = createCommitGateStream(source, {
      onRetryNeeded: async () => null,
    });
    const reader = gated.getReader();

    sourceController.enqueue(asPart({ type: "stream-start", warnings: [] }));
    sourceController.enqueue(
      asPart({ type: "response-metadata", id: "resp_1" }),
    );

    // Setup must stay held until progress arrives.
    let firstResolved = false;
    const firstRead = reader.read().then((result) => {
      firstResolved = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstResolved).toBe(false);

    sourceController.enqueue(asPart({ type: "reasoning-start", id: "rs_1" }));
    sourceController.enqueue(
      asPart({
        type: "reasoning-delta",
        id: "rs_1",
        delta: "Working…",
      }),
    );

    await expect(firstRead).resolves.toMatchObject({
      done: false,
      value: { type: "stream-start" },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "reasoning-start", id: "rs_1" },
    });
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "reasoning-delta", id: "rs_1", delta: "Working…" },
    });

    // response-metadata is held until commit/end (not flushed with progress).
    sourceController.close();
    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { type: "response-metadata", id: "resp_1" },
    });
  });

  it("retries without re-emitting stream-start when first attempt setup was held", async () => {
    const onRetryNeeded = vi.fn(async () => retrySuccessWithSetupStream());

    const stream = createCommitGateStream(
      partsStream(failedAttemptWithSetupParts()),
      { onRetryNeeded },
    );

    const parts = await collectParts(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("agent-error");
    // Failed attempt setup was discarded; only retry setup leaves the gate.
    expect(parts.map((part) => part.type)).toEqual([
      "stream-start",
      "response-metadata",
      "text-delta",
      "finish",
    ]);
    const metadata = parts.find((part) => part.type === "response-metadata");
    expect(metadata).toMatchObject({ id: "resp_retry" });
  });

  it("retries after progress without a second stream-start or failed response id", async () => {
    const onRetryNeeded = vi.fn(async () => retrySuccessWithSetupStream());

    const stream = createCommitGateStream(
      partsStream(
        failedAttemptWithSetupParts([
          { type: "reasoning-start", id: "rs_1" },
          {
            type: "reasoning-delta",
            id: "rs_1",
            delta: "Still working…",
          },
          { type: "reasoning-end", id: "rs_1" },
        ]),
      ),
      { onRetryNeeded },
    );

    const parts = await collectParts(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    // stream-start flushed with progress; failed response-metadata discarded;
    // retry must not re-emit stream-start; only retry response id is visible.
    expect(parts.filter((part) => part.type === "stream-start")).toHaveLength(
      1,
    );
    expect(parts.map((part) => part.type)).toEqual([
      "stream-start",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "response-metadata",
      "text-delta",
      "finish",
    ]);
    const metadata = parts.find((part) => part.type === "response-metadata");
    expect(metadata).toMatchObject({ id: "resp_retry" });
  });

  it("still retries agent-error after reasoning was already forwarded", async () => {
    const onRetryNeeded = vi.fn(async () => completeReplyStream());

    const stream = createCommitGateStream(
      partsStream(agentErrorWithReasoningSourceParts()),
      { onRetryNeeded },
    );

    const types = await collectTypes(stream);
    expect(onRetryNeeded).toHaveBeenCalledOnce();
    expect(onRetryNeeded).toHaveBeenCalledWith("agent-error");
    // Pre-commit reasoning already left the gate; retry supplies the answer.
    // Buffered agent-error text is discarded on successful retry.
    expect(types).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-delta",
      "finish",
    ]);

    const textStream = createCommitGateStream(
      partsStream(agentErrorWithReasoningSourceParts()),
      {
        onRetryNeeded: async () => completeReplyStream(),
      },
    );
    expect(await collectText(textStream)).toBe(COMPLETE_REPLY);
  });
});
