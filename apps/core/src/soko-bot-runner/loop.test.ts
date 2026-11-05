import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runTurnLoop } from "./loop";
import { REPORT_RESERVE_MS, TIME_UP_PROMPT } from "./rounds";

const MINUTE = 60_000;
const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type Answer = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
type Streamed = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>;
type StreamPart =
  Streamed["stream"] extends ReadableStream<infer Part> ? Part : never;

/** A generate-style answer as the stream the loop reads. */
function streamOf({ content, finishReason, usage }: Answer): Streamed {
  const parts = content.flatMap((part, index): StreamPart[] => {
    const id = String(index);
    if (part.type === "text")
      return [
        { type: "text-start", id },
        { type: "text-delta", id, delta: part.text },
        { type: "text-end", id },
      ];
    return part.type === "tool-call" ? [part] : [];
  });
  return {
    stream: simulateReadableStream({
      chunks: [...parts, { type: "finish", finishReason, usage }],
    }),
  };
}

/** A model that keeps working and never says DONE until told time is up. */
function tirelessModel(clock: { now: number }) {
  const calls: { at: number; toolChoice: unknown; lastUser: string }[] = [];
  const answer = async (
    options: Parameters<MockLanguageModelV3["doStream"]>[0],
  ): Promise<Answer> => {
    const last = options.prompt.findLast((m) => m.role === "user");
    const lastUser =
      last && Array.isArray(last.content)
        ? last.content.map((p) => ("text" in p ? p.text : "")).join("")
        : "";
    calls.push({ at: clock.now, toolChoice: options.toolChoice, lastUser });
    clock.now += 4 * MINUTE;
    if (options.toolChoice?.type === "none")
      return {
        content: [
          { type: "text", text: "DONE: filled 12 of 30 rows; 18 left." },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        warnings: [],
        usage,
      };
    return {
      content: [
        {
          type: "tool-call",
          toolCallId: `call_${calls.length}`,
          toolName: "work",
          input: "{}",
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      warnings: [],
      usage,
    };
  };
  const model = new MockLanguageModelV3({
    doStream: async (options) => streamOf(await answer(options)),
  });
  return { model, calls };
}

const tools = {
  work: tool({
    inputSchema: z.object({}),
    execute: async () => "saved a batch",
  }),
};

describe("runTurnLoop", () => {
  it("stops a background run before its deadline and posts its report", async () => {
    const clock = { now: 0 };
    const deadline = 20 * MINUTE;
    const { model, calls } = tirelessModel(clock);

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "Fill the table.",
      tools,
      maxSteps: 500,
      background: true,
      deadline,
      stopped: new AbortController().signal,
      now: () => clock.now,
    });

    expect(result.text).toBe("filled 12 of 30 rows; 18 left.");
    const final = calls.at(-1);
    expect(final?.toolChoice).toEqual({ type: "none" });
    expect(final?.lastUser).toBe(TIME_UP_PROMPT);
    expect(final?.at).toBeGreaterThanOrEqual(deadline - REPORT_RESERVE_MS);
    expect(final?.at).toBeLessThan(deadline);
    expect(calls.slice(0, -1).every((call) => call.toolChoice !== "none")).toBe(
      true,
    );
  });

  it("answers a chat turn once, without the report round", async () => {
    const clock = { now: 0 };
    const model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf({
          content: [{ type: "text", text: "Hi Patrick." }],
          finishReason: { unified: "stop", raw: "stop" },
          warnings: [],
          usage,
        }),
    });

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "hi",
      tools,
      maxSteps: 50,
      background: false,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => clock.now,
    });

    expect(result.text).toBe("Hi Patrick.");
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
