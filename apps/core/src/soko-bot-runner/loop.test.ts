import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { turnTokenBudget } from "../lib/soko-bot/turn-budget";
import { runTurnLoop, type TurnLoopPlan } from "./loop";
import {
  FOREGROUND_TIME_UP_PROMPT,
  KEEP_GOING_PROMPT,
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

  it.each([
    // Codex rounds 8 and 13: limit 25 with two parts; limit 10 with three.
    [25, 2],
    [10, 3],
  ])(
    "admits %i tokens' worth of work across %i parts at once, and the turn alone writes the one wrap-up",
    async (limit, parts) => {
      const clock = { now: 0 };
      const budget = turnTokenBudget(limit, 10);
      const models = Array.from({ length: parts }, () => tirelessModel(clock));
      const main = tirelessModel(clock);
      const loop = (model: typeof main.model, part: boolean) =>
        runTurnLoop({
          model,
          system: "You are a bot.",
          message: "Work.",
          tools,
          maxSteps: 500,
          budget,
          part,
          background: false,
          deadline: 600 * MINUTE,
          stopped: new AbortController().signal,
          now: () => clock.now,
        });

      const handOvers = await Promise.all(
        models.map(({ model }) => loop(model, true)),
      );
      const result = await loop(main.model, false);

      const all = [...models.flatMap(({ calls }) => calls), ...main.calls];
      const wrapUps = all.filter(
        (call) => (call.toolChoice as { type?: string })?.type === "none",
      );
      // One wrap-up, the turn's; a part out of budget makes no call.
      expect(wrapUps).toHaveLength(1);
      expect(main.calls).toEqual([wrapUps[0]]);
      expect(
        handOvers.filter((handOver) =>
          handOver.text.includes("This part stopped before it finished"),
        ).length,
      ).toBeGreaterThan(0);
      expect(result.text).toContain("filled 12 of 30 rows");
      // Within the allowance plus the one reserved wrap-up step.
      expect(budget.used).toBeLessThanOrEqual(limit + 10);
      expect(budget.reserved).toBe(0);
    },
  );

  it("lets parts that reach their step ceiling hand back without a report of their own", async () => {
    // Codex round 16: three parts at 12 steps each, 10 tokens a step, on a
    // 370-token allowance made three part reports and the turn's fourth.
    const clock = { now: 0 };
    const budget = turnTokenBudget(370, 10);
    const models = Array.from({ length: 3 }, () => tirelessModel(clock));
    const main = tirelessModel(clock);
    const loop = (model: typeof main.model, part: boolean, maxSteps: number) =>
      runTurnLoop({
        model,
        system: "You are a bot.",
        message: "Work.",
        tools,
        maxSteps,
        budget,
        part,
        background: false,
        deadline: 6_000 * MINUTE,
        stopped: new AbortController().signal,
        now: () => clock.now,
      });

    await Promise.all(models.map(({ model }) => loop(model, true, 12)));
    await loop(main.model, false, 500);

    const wrapUps = [
      ...models.flatMap(({ calls }) => calls),
      ...main.calls,
    ].filter((call) => (call.toolChoice as { type?: string })?.type === "none");
    expect(wrapUps).toHaveLength(1);
    expect(main.calls.at(-1)?.toolChoice).toEqual({ type: "none" });
    // 36 part steps, the turn's own steps up to the limit, one wrap-up.
    expect(budget.used).toBeLessThanOrEqual(370 + 10);
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

describe("the done check (planLoop)", () => {
  /** A model that answers in text every time; the user prompts it saw. */
  function answeringModel() {
    const seen: string[] = [];
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        const last = options.prompt.findLast((m) => m.role === "user");
        seen.push(
          last && Array.isArray(last.content)
            ? last.content.map((p) => ("text" in p ? p.text : "")).join("")
            : "",
        );
        return streamOf({
          content: [{ type: "text", text: `Answer ${seen.length}.` }],
          finishReason: { unified: "stop", raw: "stop" },
          warnings: [],
          usage,
        });
      },
    });
    return { model, seen };
  }

  const loopInput = (
    model: MockLanguageModelV3,
    // A plan from earlier in the request, unless a test says otherwise.
    plan: Omit<TurnLoopPlan, "inherited"> & { inherited?: boolean },
    extra: Partial<Parameters<typeof runTurnLoop>[0]> = {},
  ) => ({
    model,
    system: "You are a bot.",
    message: "Do the three things.",
    tools,
    maxSteps: 50,
    background: false,
    deadline: 60 * MINUTE,
    stopped: new AbortController().signal,
    now: () => 0,
    plan: { inherited: true, ...plan },
    ...extra,
  });

  it("sends a foreground answer back once while the plan has open steps", async () => {
    const { model, seen } = answeringModel();
    const drafts: string[] = [];
    const result = await runTurnLoop(
      loopInput(model, {
        doneCheck: async (draft) => {
          drafts.push(draft);
          return "Your plan still lists open steps: s2.";
        },
        openSteps: async () => null,
      }),
    );
    expect(drafts).toEqual(["Answer 1."]);
    expect(seen).toEqual([
      "Do the three things.",
      "Your plan still lists open steps: s2.",
    ]);
    expect(result.text).toBe("Answer 2.");
  });

  it("asks Core nothing on a turn with no plan, until the turn writes one", async () => {
    let asked = 0;
    const plan = {
      inherited: false,
      doneCheck: async () => {
        asked += 1;
        return null;
      },
      openSteps: async () => {
        asked += 1;
        return null;
      },
    };
    await runTurnLoop(loopInput(answeringModel().model, plan));
    expect(asked).toBe(0);

    // The same turn after an update_plan call asks once it answers.
    let calls = 0;
    const planning = new MockLanguageModelV3({
      doStream: async () => {
        calls += 1;
        return streamOf(
          calls === 1
            ? {
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "plan_1",
                    toolName: "update_plan",
                    input: "{}",
                  },
                ],
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                warnings: [],
                usage,
              }
            : {
                content: [{ type: "text", text: "Planned." }],
                finishReason: { unified: "stop", raw: "stop" },
                warnings: [],
                usage,
              },
        );
      },
    });
    await runTurnLoop(
      loopInput(planning, plan, {
        tools: {
          ...tools,
          update_plan: tool({
            inputSchema: z.object({}),
            execute: async () => ({ revision: 1 }),
          }),
        },
      }),
    );
    expect(asked).toBe(1);
  });

  it("keeps the finished answer when Core's check used up the turn's time", async () => {
    const clock = { now: 0 };
    const { model } = answeringModel();
    const result = await runTurnLoop(
      loopInput(
        model,
        {
          doneCheck: async () => {
            // The check answers, but only after the round's time is gone.
            clock.now = 59 * MINUTE;
            return "Go back.";
          },
          openSteps: async () => null,
        },
        { now: () => clock.now },
      ),
    );
    expect(result.text).toBe("Answer 1.");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("does not ask when the tokens left would not cover the round and a wrap-up", async () => {
    let asked = 0;
    const plan = {
      doneCheck: async () => {
        asked += 1;
        return "Go back.";
      },
      openSteps: async () => null,
    };
    // 10 tokens spent, steps reserve 100: 140 left is less than two steps.
    const { model } = answeringModel();
    const result = await runTurnLoop(
      loopInput(model, plan, { budget: turnTokenBudget(150, 100) }),
    );
    expect(asked).toBe(0);
    expect(result.text).toBe("Answer 1.");
  });

  /** Text first, then each answer in turn: tool calls or text. */
  function scriptedModel(answers: ("tool" | string | Error)[]) {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const answer = answers[Math.min(calls, answers.length - 1)];
        calls += 1;
        if (answer instanceof Error) throw answer;
        return streamOf(
          answer === "tool"
            ? {
                content: [
                  {
                    type: "tool-call",
                    toolCallId: `call_${calls}`,
                    toolName: "work",
                    input: "{}",
                  },
                ],
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                warnings: [],
                usage,
              }
            : {
                content: [{ type: "text", text: answer }],
                finishReason: { unified: "stop", raw: "stop" },
                warnings: [],
                usage,
              },
        );
      },
    });
    return { model, calls: () => calls };
  }
  const goBack = {
    doneCheck: async () => "Go back.",
    openSteps: async () => null,
  };

  it("takes the extra round's answer when it saved and answered on its last step", async () => {
    const { model } = scriptedModel([
      "The note still needs saving.",
      "tool",
      "The note is saved in Files.",
    ]);
    const result = await runTurnLoop(loopInput(model, goBack, { maxSteps: 3 }));
    expect(result.text).toBe("The note is saved in Files.");
  });

  it("keeps the finished answer when the extra round fails", async () => {
    const { model } = scriptedModel([
      "Here is your summary.",
      new Error("provider down"),
    ]);
    const result = await runTurnLoop(loopInput(model, goBack));
    expect(result.text).toBe("Here is your summary.");
  });

  it("asks nothing after a first plan Core refused", async () => {
    let asked = 0;
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls += 1;
        return streamOf(
          calls === 1
            ? {
                content: [
                  {
                    type: "tool-call",
                    toolCallId: "plan_1",
                    toolName: "update_plan",
                    input: "{}",
                  },
                ],
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                warnings: [],
                usage,
              }
            : {
                content: [{ type: "text", text: "Answer." }],
                finishReason: { unified: "stop", raw: "stop" },
                warnings: [],
                usage,
              },
        );
      },
    });
    await runTurnLoop(
      loopInput(
        model,
        {
          inherited: false,
          doneCheck: async () => {
            asked += 1;
            return null;
          },
          openSteps: async () => null,
        },
        {
          tools: {
            update_plan: tool({
              inputSchema: z.object({}),
              execute: async (): Promise<string> => {
                throw new Error("The plan must keep every step it has now");
              },
            }),
          },
        },
      ),
    );
    expect(asked).toBe(0);
  });

  it("keeps the finished answer when the extra round runs out of steps", async () => {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls += 1;
        return streamOf(
          calls === 1
            ? {
                content: [{ type: "text", text: "Here is your summary." }],
                finishReason: { unified: "stop", raw: "stop" },
                warnings: [],
                usage,
              }
            : {
                content: [
                  {
                    type: "tool-call",
                    toolCallId: `call_${calls}`,
                    toolName: "work",
                    input: "{}",
                  },
                ],
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                warnings: [],
                usage,
              },
        );
      },
    });
    const result = await runTurnLoop(
      loopInput(
        model,
        { doneCheck: async () => "Go back.", openSteps: async () => null },
        { maxSteps: 3 },
      ),
    );
    expect(result.text).toBe("Here is your summary.");
    // The answer, the extra round's two steps, and no wrap-up call after it:
    // the answer was already there.
    expect(calls).toBe(3);
  });

  it("lets the answer through when Core does or cannot answer", async () => {
    for (const doneCheck of [
      async () => null,
      async () => {
        throw new Error("Core is down");
      },
    ]) {
      const { model } = answeringModel();
      const result = await runTurnLoop(
        loopInput(model, { doneCheck, openSteps: async () => null }),
      );
      expect(result.text).toBe("Answer 1.");
      expect(model.doStreamCalls).toHaveLength(1);
    }
  });

  it("never asks with one step left, in a part, or in a background run", async () => {
    let asked = 0;
    const plan = {
      doneCheck: async () => {
        asked += 1;
        return "Go back.";
      },
      openSteps: async () => null,
    };
    await runTurnLoop(loopInput(answeringModel().model, plan, { maxSteps: 2 }));
    await runTurnLoop(loopInput(answeringModel().model, plan, { part: true }));
    await runTurnLoop(
      loopInput(answeringModel().model, plan, {
        background: true,
        message: "Brief.",
      }),
    );
    expect(asked).toBe(0);
  });

  it("names the plan's open steps in the keep-going nudge", async () => {
    const { model, seen } = answeringModel();
    await runTurnLoop(
      loopInput(
        model,
        {
          doneCheck: async () => null,
          openSteps: async () => "- s2 [pending] Rows",
        },
        { background: true, message: "Brief." },
      ),
    );
    expect(seen[1]).toBe(`${KEEP_GOING_PROMPT}\n\n- s2 [pending] Rows`);
  });

  it("names the plan's open steps in the time-up report", async () => {
    const clock = { now: 0 };
    const { model, calls } = tirelessModel(clock);
    await runTurnLoop({
      model,
      system: "You are a bot.",
      message: "Fill the table.",
      tools,
      maxSteps: 500,
      background: true,
      deadline: 60 * MINUTE,
      stopped: new AbortController().signal,
      now: () => clock.now,
      plan: {
        inherited: true,
        doneCheck: async () => null,
        openSteps: async () =>
          "Open steps in your plan (revision 2):\n- s2 [pending] Rows 13 to 30",
      },
    });
    const report = calls.at(-1);
    expect(report?.toolChoice).toEqual({ type: "none" });
    expect(report?.lastUser).toBe(
      `${TIME_UP_PROMPT}\n\nOpen steps in your plan (revision 2):\n- s2 [pending] Rows 13 to 30`,
    );
  });
});
