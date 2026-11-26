import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { turnTokenBudget } from "../lib/soko-bot/turn-budget";
import { runTurnLoop } from "./loop";
import {
  FOREGROUND_TIME_UP_PROMPT,
  REPORT_RESERVE_MS,
  TIME_UP_PROMPT,
} from "./rounds";

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

  it("shows a nudged background run the tool calls it already made", async () => {
    const stream = (
      content: Answer["content"],
      finish: "stop" | "tool-calls",
    ) =>
      streamOf({
        content,
        finishReason: { unified: finish, raw: finish },
        warnings: [],
        usage,
      });
    const model = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        const roles = prompt.map((message) => message.role);
        if (!roles.includes("tool"))
          return stream(
            [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "work",
                input: "{}",
              },
            ],
            "tool-calls",
          );
        return roles.at(-1) === "tool"
          ? stream([{ type: "text", text: "The draft is saved." }], "stop")
          : stream([{ type: "text", text: "DONE: saved one draft." }], "stop");
      },
    });
    let worked = 0;

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "Save one draft.",
      tools: {
        work: tool({
          inputSchema: z.object({}),
          execute: async () => {
            worked += 1;
            return "saved a draft";
          },
        }),
      },
      maxSteps: 50,
      background: true,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => 0,
    });

    expect(result.text).toBe("saved one draft.");
    expect(worked).toBe(1);
    expect(
      model.doStreamCalls.at(-1)?.prompt.map((message) => message.role),
    ).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
  });

  it("takes a follow-up's JSON answer with DONE in its message as the report", async () => {
    // Prod turn 01a1fbce…: the follow-up of an ask_coworker wait_for. Its
    // first answer relayed Hannah's reply; the nudge it got instead turned
    // into "Shared Hannah's reply…", which the claim check withheld.
    const answers = [
      JSON.stringify({
        kind: "REPORT",
        message:
          "DONE: Hannah says her day's been productive: she wrapped up a few research tasks on agentic commerce.",
        question: null,
        observationToolCallIds: [],
      }),
      JSON.stringify({
        kind: "REPORT",
        message: "DONE: Shared Hannah's reply with Patrick in this chat.",
        question: null,
        observationToolCallIds: [],
      }),
    ];
    const model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf({
          content: [{ type: "text", text: answers.shift() ?? "" }],
          finishReason: { unified: "stop", raw: "stop" },
          warnings: [],
          usage,
        }),
    });

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message:
        "Follow-up: something you were waiting for is done.\nNew in the chat:\n- Hannah: Day's been productive.\n\nYour plan: Share Hannah's reply with Patrick in this chat.",
      tools,
      maxSteps: 50,
      background: true,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => 0,
    });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.parse(result.text).message).toBe(
      "Hannah says her day's been productive: she wrapped up a few research tasks on agentic commerce.",
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

  it.each([
    ["google/gemini-2.5-flash-lite", undefined],
    ["google/gemini-3.6-flash", { thinkingConfig: { includeThoughts: true } }],
  ])(
    "sends the Google reasoning summary options for %s",
    async (modelId, google) => {
      const model = new MockLanguageModelV3({
        modelId,
        doStream: async () =>
          streamOf({
            content: [{ type: "text", text: "Hi." }],
            finishReason: { unified: "stop", raw: "stop" },
            warnings: [],
            usage,
          }),
      });

      await runTurnLoop({
        model,
        system: "You are a bot.",
        message: "hi",
        tools: {},
        maxSteps: 1,
        background: false,
        deadline: MINUTE,
        stopped: new AbortController().signal,
        now: () => 0,
      });

      expect(model.doStreamCalls[0]?.providerOptions?.google).toEqual(google);
    },
  );

  it("reports each step's reasoning summary as the step ends", async () => {
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        call += 1;
        const reasoning: StreamPart[] = [
          { type: "reasoning-start", id: "r" },
          { type: "reasoning-delta", id: "r", delta: ` Thought ${call}. ` },
          { type: "reasoning-end", id: "r" },
          { type: "reasoning-start", id: "r2" },
          { type: "reasoning-delta", id: "r2", delta: "Next." },
          { type: "reasoning-end", id: "r2" },
        ];
        const answer = streamOf(
          call === 1
            ? {
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "call_1",
                    toolName: "work",
                    input: "{}",
                  },
                ],
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                warnings: [],
                usage,
              }
            : {
                content: [{ type: "text", text: "Done." }],
                finishReason: { unified: "stop", raw: "stop" },
                warnings: [],
                usage,
              },
        );
        const parts: StreamPart[] = [];
        for await (const part of answer.stream) parts.push(part);
        return {
          stream: simulateReadableStream({ chunks: [...reasoning, ...parts] }),
        };
      },
    });
    const told: string[] = [];

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "hi",
      tools,
      maxSteps: 50,
      background: false,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      onReasoning: async (summary) => {
        told.push(summary);
      },
      now: () => 0,
    });

    expect(result.text).toBe("Done.");
    // One paragraph per summary part, not run together.
    expect(told).toEqual(["Thought 1.\n\nNext.", "Thought 2.\n\nNext."]);
  });

  it("answers a chat turn that ran out of steps mid-work, in one call without tools", async () => {
    const clock = { now: 0 };
    const { model, calls } = tirelessModel(clock);

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "Fill the table.",
      tools,
      maxSteps: 3,
      background: false,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => clock.now,
    });

    expect(calls).toHaveLength(4);
    expect(calls.at(-1)?.toolChoice).toEqual({ type: "none" });
    expect(calls.at(-1)?.lastUser).toBe(FOREGROUND_TIME_UP_PROMPT);
    expect(result.text).toContain("filled 12 of 30 rows");
  });

  it("stops a run at its token budget and reports", async () => {
    const clock = { now: 0 };
    const { model, calls } = tirelessModel(clock);

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "Fill the table.",
      tools,
      maxSteps: 500,
      budget: turnTokenBudget(25, 10),
      background: true,
      deadline: 600 * MINUTE,
      stopped: new AbortController().signal,
      now: () => clock.now,
    });

    // 10 input tokens a step: a third would pass 25, so two run, then the report.
    expect(calls).toHaveLength(3);
    expect(calls.at(-1)?.lastUser).toBe(TIME_UP_PROMPT);
    expect(result.text).toBe("filled 12 of 30 rows; 18 left.");
  });

  it("shares one budget between a turn's parts and its main loop, and still reports", async () => {
    const clock = { now: 0 };
    const budget = turnTokenBudget(45, 10);
    const part = tirelessModel(clock);
    const main = tirelessModel(clock);
    const loop = (model: typeof part.model, maxSteps: number) =>
      runTurnLoop({
        model,
        system: "You are a bot.",
        message: "Work.",
        tools,
        maxSteps,
        budget,
        background: false,
        deadline: 600 * MINUTE,
        stopped: new AbortController().signal,
        now: () => clock.now,
      });

    await loop(part.model, 4);
    expect(budget.used).toBeGreaterThanOrEqual(40);
    const result = await loop(main.model, 500);

    // The parts spent the allowance: the main loop only writes its answer.
    expect(main.calls).toHaveLength(1);
    expect(main.calls.at(-1)?.toolChoice).toEqual({ type: "none" });
    expect(result.text).toContain("filled 12 of 30 rows");
  });

  it("admits two parts running at once against one allowance", async () => {
    // Codex's fixture (review-8271-budget-and-local-fit): limit 25, 10 a step.
    const clock = { now: 0 };
    const budget = turnTokenBudget(25, 10);
    const one = tirelessModel(clock);
    const two = tirelessModel(clock);
    const part = (model: typeof one.model) =>
      runTurnLoop({
        model,
        system: "You are a bot.",
        message: "Work.",
        tools,
        maxSteps: 500,
        budget,
        background: false,
        deadline: 600 * MINUTE,
        stopped: new AbortController().signal,
        now: () => clock.now,
      });

    await Promise.all([part(one.model), part(two.model)]);

    const working = [...one.calls, ...two.calls].filter(
      (call) => (call.toolChoice as { type?: string })?.type !== "none",
    );
    // Each part was admitted once, the room both saw already reserved; then
    // each wrote its one answer without tools.
    expect(working).toHaveLength(2);
    expect(one.calls.at(-1)?.toolChoice).toEqual({ type: "none" });
    expect(two.calls.at(-1)?.toolChoice).toEqual({ type: "none" });
    expect(budget.reserved).toBe(0);
    expect(budget.used).toBe(40);
  });

  it("ends on the step whose tool said so, without a closing step", async () => {
    const clock = { now: 0 };
    const model = new MockLanguageModelV3({
      doStream: async () =>
        streamOf({
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "save",
              input: "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          warnings: [],
          usage,
        }),
    });

    const result = await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "Save the essentials",
      tools: {
        save: tool({
          inputSchema: z.object({}),
          execute: async () => ({ endTurn: "Scheduling for everyone" }),
        }),
      },
      maxSteps: 50,
      background: false,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => clock.now,
    });

    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.parse(result.text).message).toBe("Scheduling for everyone");
  });

  it("offers the full save tool on the round after a short-form call", async () => {
    const offered: string[][] = [];
    const keys: unknown[] = [];
    const saved: unknown[] = [];
    const stream = (
      content: Answer["content"],
      finish: "stop" | "tool-calls",
    ) =>
      streamOf({
        content,
        finishReason: { unified: finish, raw: finish },
        warnings: [],
        usage,
      });
    const model = new MockLanguageModelV3({
      doStream: async ({ tools: sent, prompt, providerOptions }) => {
        const schema = sent?.find((t) => t.name === "save_strategy") as
          | { inputSchema: { properties?: Record<string, unknown> } }
          | undefined;
        offered.push(Object.keys(schema?.inputSchema.properties ?? {}));
        keys.push(providerOptions?.openai?.promptCacheKey);
        const results = prompt.filter((m) => m.role === "tool").length;
        if (results === 0)
          return stream(
            [
              {
                type: "tool-call",
                toolCallId: "short",
                toolName: "save_strategy",
                input: JSON.stringify({ shortForm: true, what: "move a post" }),
              },
            ],
            "tool-calls",
          );
        if (results === 1)
          return stream(
            [
              {
                type: "tool-call",
                toolCallId: "full",
                toolName: "save_strategy",
                input: JSON.stringify({ part: "pieces" }),
              },
            ],
            "tool-calls",
          );
        return stream([{ type: "text", text: "Moved it." }], "stop");
      },
    });

    const result = await runTurnLoop({
      model,
      system: "You are Cuso.",
      message: "Move Friday's post to Monday.",
      tools: {
        save_strategy: tool({
          inputSchema: z.object({ part: z.string() }),
          execute: async (input: unknown) => {
            saved.push(input);
            return { saved: true };
          },
        }),
      },
      maxSteps: 10,
      background: false,
      deadline: Date.now() + 10 * MINUTE,
      stopped: new AbortController().signal,
      shortForms: ["save_strategy"],
      cacheKey: "cmo-v24:short",
      fullCacheKey: "cmo-v24:full",
    });

    expect(result.text).toBe("Moved it.");
    expect(offered[0]).toEqual(["shortForm", "what"]);
    expect(offered.slice(1).every((keys) => keys.includes("part"))).toBe(true);
    // Each tool set has its own prefix, so its own cache key.
    expect(keys[0]).toBe("cmo-v24:short");
    expect(keys.slice(1).every((key) => key === "cmo-v24:full")).toBe(true);
    expect(saved).toEqual([
      { shortForm: true, what: "move a post" },
      { part: "pieces" },
    ]);
  });

  it.each([
    ["tokens", { inputTokenBudget: 10, advanceMs: 0 }],
    ["time", { inputTokenBudget: undefined, advanceMs: 9 * MINUTE }],
  ])(
    "gives a short-form call that spends the last %s no second round, and still answers",
    async (_limit, edge) => {
      const clock = { now: 0 };
      const calls: { toolChoice: unknown; keys: string[] }[] = [];
      const model = new MockLanguageModelV3({
        doStream: async ({ tools: sent, toolChoice }) => {
          const schema = sent?.find((t) => t.name === "save_strategy") as
            | { inputSchema: { properties?: Record<string, unknown> } }
            | undefined;
          calls.push({
            toolChoice,
            keys: Object.keys(schema?.inputSchema.properties ?? {}),
          });
          clock.now += edge.advanceMs;
          return streamOf(
            toolChoice?.type === "none"
              ? {
                  content: [{ type: "text", text: "I'll save it next." }],
                  finishReason: { unified: "stop", raw: "stop" },
                  warnings: [],
                  usage,
                }
              : {
                  content: [
                    {
                      type: "tool-call",
                      toolCallId: "short",
                      toolName: "save_strategy",
                      input: JSON.stringify({ shortForm: true, what: "x" }),
                    },
                  ],
                  finishReason: { unified: "tool-calls", raw: "tool_calls" },
                  warnings: [],
                  usage,
                },
          );
        },
      });

      const result = await runTurnLoop({
        model,
        system: "You are Cuso.",
        message: "Move Friday's post to Monday.",
        tools: {
          save_strategy: tool({
            inputSchema: z.object({ part: z.string() }),
            execute: async () => ({ saved: false }),
          }),
        },
        maxSteps: 10,
        budget:
          edge.inputTokenBudget === undefined
            ? undefined
            : turnTokenBudget(edge.inputTokenBudget, 1),
        background: false,
        deadline: 10 * MINUTE,
        stopped: new AbortController().signal,
        now: () => clock.now,
        shortForms: ["save_strategy"],
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]?.keys).toEqual(["shortForm", "what"]);
      expect(calls[1]?.toolChoice).toEqual({ type: "none" });
      expect(result.text).toBe("I'll save it next.");
    },
  );

  it("keeps a skill read early in a long turn whole, so its last rule still reaches the model", async () => {
    const skill = `# Strategy\n${"rule ".repeat(10_000)}LAST RULE: never post on Sundays.`;
    const prompts: string[] = [];
    let step = 0;
    const model = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt));
        step += 1;
        const call = (toolName: string, input: object) =>
          streamOf({
            content: [
              {
                type: "tool-call",
                toolCallId: `c${step}`,
                toolName,
                input: JSON.stringify(input),
              },
            ],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            warnings: [],
            usage,
          });
        if (step === 1) return call("read_skill", { skill: "cmo-strategy" });
        if (step <= 24) return call("work", {});
        return streamOf({
          content: [{ type: "text", text: "No Sunday posts." }],
          finishReason: { unified: "stop", raw: "stop" },
          warnings: [],
          usage,
        });
      },
    });

    await runTurnLoop({
      model,
      system: "You are Cuso.",
      message: "Plan the week.",
      tools: {
        read_skill: tool({
          inputSchema: z.object({ skill: z.string() }),
          execute: async () => ({ content: skill }),
        }),
        work: tool({
          inputSchema: z.object({}),
          execute: async () => ({ rows: "x".repeat(5_000) }),
        }),
      },
      maxSteps: 40,
      background: false,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => 0,
    });

    const last = prompts.at(-1) ?? "";
    expect(last).toContain("LAST RULE: never post on Sundays.");
    expect(last).toContain("shortened to save room");
  });
});
