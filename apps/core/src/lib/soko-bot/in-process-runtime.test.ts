import { simulateReadableStream, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pendingTurns: Promise<unknown>[] = [];

const {
  reconcileRuntimeCompletionMock,
  authorizeMock,
  activeRunsMock,
  createEventMock,
  executeToolMock,
  findFirstMock,
  findManyMock,
  streamModelCallMock,
  claimsActionMock,
  getContextMock,
  cmoTurnPartsMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  cmoTurnPartsMock: vi.fn(),
  reconcileRuntimeCompletionMock: vi.fn(),
  authorizeMock: vi.fn(),
  activeRunsMock: vi.fn(async (_id: string, text: string) => text),
  createEventMock: vi.fn(),
  executeToolMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  streamModelCallMock: vi.fn(),
  claimsActionMock: vi.fn(async () => false),
  getContextMock: vi.fn(),
  // The real waitUntil detaches the turn, so tests await the captured promise.
  waitUntilMock: vi.fn((promise: Promise<unknown>) => {
    pendingTurns.push(promise);
  }),
}));

// PostgreSQL's clock is the test clock here.
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: waitUntilMock }));
// The canned replies here all claim work; Jev is not called from a test.
// A reply claims nothing unless a test says so: claiming by default withheld
// every reply, including in tests about metering, regions and deadlines.
vi.mock("./answer-claims", () => ({ claimsAction: claimsActionMock }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  stepCountIs: (count: number) => count,
  tool: (definition: unknown) => definition,
}));
vi.mock("./stream-model-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stream-model-call")>()),
  streamModelCall: streamModelCallMock,
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    sokoBotRuntimeEvent: {
      create: createEventMock,
      findFirst: findFirstMock,
      findMany: findManyMock,
      deleteMany: vi.fn(),
    },
    evalLane: { findUnique: vi.fn().mockResolvedValue(null) },
    sokoBotTurn: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ source: "CHAT" }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        createdAt: new Date(),
        parentTurnId: null,
        deadlineAt: new Date(Date.now() + 15 * 60 * 1_000),
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    sokoBotMcpServer: { findMany: vi.fn().mockResolvedValue([]) },
    sokoBotToolCall: { findMany: vi.fn().mockResolvedValue([]) },
    sokoBotModelCall: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    default: {
      ...client,
      $transaction: (operation: (tx: unknown) => Promise<unknown>) =>
        operation({ ...client, $executeRaw: vi.fn() }),
    },
  };
});
// Jev is not called from a test: the language stays unnamed.
vi.mock("./jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jev")>()),
  evaluateWithJev: () => Promise.reject(new Error("No Jev in tests")),
}));
vi.mock("./active-background-runs", () => ({
  withActiveBackgroundRuns: activeRunsMock,
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: {
    reconcileRuntimeCompletion: reconcileRuntimeCompletionMock,
  },
}));
vi.mock("@/services/cmo-hiring.service", () => ({
  cmoTurnParts: cmoTurnPartsMock,
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: {
    authorize: authorizeMock,
    getContext: getContextMock,
    executeTool: executeToolMock,
  },
}));

import prisma from "@/lib/db/prisma";
import {
  FOREGROUND_TIME_UP_PROMPT,
  KEEP_GOING_PROMPT,
  TIME_UP_PROMPT,
} from "@/soko-bot-runner/rounds";
import { expectCoreLog } from "@/test/core-log";
import { REPLY_CHECK_NOTES } from "./action-response";
import * as evaluation from "./evaluation-dispatch";
import { InProcessSokoBotRuntime } from "./in-process-runtime";
import { sokoBotRegionMiddleware } from "./model-policy";
import {
  MODEL_STREAM_IDLE_MS,
  ModelStreamStalledError,
} from "./stream-model-call";
import { endedByTool } from "./turn-parts";

/** The model as the runtime gets it: behind the region check. */
function behindRegionCheck(model: MockLanguageModelV3) {
  return wrapLanguageModel({
    model,
    middleware: sokoBotRegionMiddleware({
      model: "google/gemini-3.6-flash",
      role: "agent",
    }),
  });
}

const TURN_ID = "01960001-0001-7001-8001-000000000001";

function recordedEvents(): { type: string; data: Record<string, unknown> }[] {
  return createEventMock.mock.calls.map((call) => call[0].data);
}

describe("InProcessSokoBotRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingTurns.length = 0;
    activeRunsMock.mockReset().mockImplementation(async (_, text) => text);
    findFirstMock.mockResolvedValue(null);
    authorizeMock.mockResolvedValue({
      turn: { id: TURN_ID, versionId: "v11" },
      grant: { capabilities: ["create_task"] },
    });
    getContextMock.mockResolvedValue({
      version: { id: "v11", name: "v11 test", systemPrompt: "Be useful." },
      packet: { memory: { version: 1 } },
    });
    cmoTurnPartsMock.mockResolvedValue([]);
    streamModelCallMock.mockReset().mockImplementation(async (options) => {
      // The SDK reports each step through onStepFinish; the drain meters those.
      await options.onStepFinish?.({
        usage: {
          inputTokens: 20,
          outputTokens: 5,
          inputTokenDetails: { cacheReadTokens: 7, cacheWriteTokens: 0 },
        },
        providerMetadata: { gateway: { cost: "0.0136" } },
        reasoning: [
          { type: "reasoning", text: " Weighing who should take this. " },
          { type: "reasoning", text: "" },
          { type: "reasoning", text: "Alex writes." },
        ],
      });
      return {
        text: "Delegated to a Coworker.",
        finishReason: "stop",
        steps: [],
        responseMessages: [],
      };
    });
  });

  it("runs the turn and records the events the drain settles on", async () => {
    // The canned reply claims a delegation no receipt backs, so it is held.
    claimsActionMock.mockResolvedValueOnce(true);
    const withheld = expectCoreLog(
      "warn",
      "Cut a Soko Bot reply's claim of an unconfirmed change",
    );
    const runtime = new InProcessSokoBotRuntime();

    const ref = await runtime.createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });

    await Promise.all(pendingTurns);

    expect(ref.runtimeVersion).toBe("in-process-1");
    expect(recordedEvents().map((event) => event.type)).toEqual([
      "session.started",
      "turn.started",
      "message.received",
      "step.started",
      "reasoning.completed",
      "step.completed",
      "message.completed",
      "turn.completed",
      "session.waiting",
    ]);
    // The step's reasoning summary is on the turn before the step settles,
    // and the model is asked for one as the sandbox runner asks.
    expect(
      recordedEvents().find((event) => event.type === "reasoning.completed")
        ?.data.text,
    ).toBe("Weighing who should take this.\n\nAlex writes.");
    expect(streamModelCallMock.mock.calls[0][0].providerOptions.openai).toEqual(
      { reasoningSummary: "auto" },
    );
    const completed = recordedEvents().find(
      (event) => event.type === "message.completed",
    );
    expect(completed?.data.message).toBe(
      `Nothing was changed in this turn.\n\n${REPLY_CHECK_NOTES.cut}`,
    );
    expect(withheld[0]?.event).toMatchObject({
      replyChecked: { reason: "claims_unconfirmed_change" },
    });
  });

  it.each([
    ["cmo-v1-gemini-25-flash-lite", "google/gemini-2.5-flash-lite", undefined],
    [
      "v11",
      "google/gemini-3.6-flash",
      { thinkingConfig: { includeThoughts: true } },
    ],
  ])(
    "sends the Google reasoning summary options for %s",
    async (versionId, modelId, google) => {
      authorizeMock.mockResolvedValueOnce({
        turn: { id: TURN_ID, versionId },
        grant: { capabilities: ["create_task"] },
      });
      await new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Plan the launch",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      });
      await Promise.all(pendingTurns);

      const request = streamModelCallMock.mock.calls[0]?.[0];
      expect(request.model.modelId).toBe(modelId);
      expect(request.providerOptions.google).toEqual(google);
    },
  );

  it("ends a Cuso turn's message with the owner's language, and no other bot's", async () => {
    const findTurn = vi.mocked(prisma.sokoBotTurn.findUnique);
    const findAsked = vi.mocked(prisma.sokoBotTurn.findMany);
    const run = async (versionId: string) => {
      findTurn.mockResolvedValue({
        source: "CHAT",
        sokoBotId: "bot_1",
        versionId,
        createdAt: new Date(),
      } as never);
      streamModelCallMock.mockClear();
      await new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Wie ranken wir bei Google?",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      });
      await Promise.all(pendingTurns);
      return streamModelCallMock.mock.calls[0][0].messages[0].content as string;
    };
    findAsked.mockResolvedValue([
      {
        id: TURN_ID,
        userMessage: "Wie ranken wir bei Google?",
        chatMention: null,
      },
    ] as never);
    try {
      expect(await run("cmo-v1")).toMatch(
        /^Wie ranken wir bei Google\?\n\n\[Reply language\. Write to the owner in the language of their new message, which ends: "Wie ranken wir bei Google\?"/,
      );
      expect(await run("v33")).toBe("Wie ranken wir bei Google?");
    } finally {
      findTurn.mockResolvedValue({ source: "CHAT" } as never);
      findAsked.mockReset();
    }
  });

  it("runs a Cuso first read's parts side by side, then the turn with their hand-overs", async () => {
    authorizeMock.mockResolvedValue({
      turn: { id: TURN_ID, versionId: "cmo-v2" },
      grant: { capabilities: ["create_task"] },
    });
    cmoTurnPartsMock.mockResolvedValue([
      {
        key: "website",
        title: "Website",
        message: "Read the site",
        tools: ["web_fetch"],
      },
      {
        key: "reviews",
        title: "Reviews",
        message: "Read the reviews",
        tools: ["web_fetch"],
      },
    ]);
    let running = 0;
    let most = 0;
    streamModelCallMock.mockImplementation(async (options) => {
      const message = options.messages[0].content as string;
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return {
        text: message.startsWith("Read the")
          ? `Found: ${message}`
          : "Saved the essentials.",
        finishReason: "stop",
        steps: [],
        responseMessages: [],
      };
    });

    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Save the essentials",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);

    expect(cmoTurnPartsMock).toHaveBeenCalledWith(TURN_ID);
    const calls = streamModelCallMock.mock.calls.map((call) => call[0]);
    expect(calls).toHaveLength(3);
    expect(most).toBe(2);
    // Parts get a short step cap; the turn keeps its own.
    expect(calls[0].stopWhen[0]).toBe(12);
    // A part never gets the turn's outward tools.
    expect(Object.keys(calls[0].tools)).toEqual([]);
    expect(Object.keys(calls[2].tools)).toEqual(["create_task"]);
    const last = calls[2].messages[0].content as string;
    expect(last.startsWith("Save the essentials")).toBe(true);
    expect(last).toContain("### Website\nFound: Read the site");
    expect(last).toContain("### Reviews\nFound: Read the reviews");
    // Every part's model call is metered like the turn's.
    expect(
      recordedEvents().filter((event) => event.type === "step.started"),
    ).toHaveLength(3);
  });

  it("gives the main call no tool to pick once a part spent the turn's allowance", async () => {
    authorizeMock.mockResolvedValue({
      turn: { id: TURN_ID, versionId: "cmo-v2" },
      grant: { capabilities: ["create_task"] },
    });
    cmoTurnPartsMock.mockResolvedValue(
      ["site", "reviews", "pricing"].map((key) => ({
        key,
        title: key,
        message: `Read the ${key}`,
        tools: ["web_fetch"],
      })),
    );
    streamModelCallMock.mockImplementation(async (options) => {
      const message = options.messages[0].content as string;
      if (message.includes("Read the"))
        await options.onStepFinish?.({
          usage: { inputTokens: 9_000_000, outputTokens: 5 },
          providerMetadata: {},
          reasoning: [],
        });
      return { text: "Done.", finishReason: "stop", steps: [] };
    });

    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Save the essentials",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);

    const calls = streamModelCallMock.mock.calls.map((call) => call[0]);
    // Exactly one wrap-up, the turn's; the parts made none of their own.
    expect(calls.filter((call) => call.toolChoice === "none")).toHaveLength(1);
    const main = calls.at(-1);
    expect(main.toolChoice).toBe("none");
    expect(main.messages.at(-1).content).toContain("you cannot call tools");
  });

  it("ends a turn on the step whose tool said so, with that tool's answer", async () => {
    authorizeMock.mockResolvedValue({
      turn: { id: TURN_ID, versionId: "cmo-v2" },
      grant: { capabilities: ["read_memory"] },
    });
    cmoTurnPartsMock.mockResolvedValue([]);
    const ended = {
      text: "",
      usage: { inputTokens: 10 },
      toolResults: [
        {
          output: {
            evidenceToolCallId: "c1",
            result: { endTurn: "Scheduling for everyone" },
          },
        },
      ],
    };
    streamModelCallMock.mockResolvedValue({
      text: "",
      finishReason: "tool-calls",
      steps: [ended],
    });

    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Save the essentials",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);

    expect(streamModelCallMock.mock.calls[0]?.[0].stopWhen).toContain(
      endedByTool,
    );
    expect(
      recordedEvents().find((event) => event.type === "message.completed")?.data
        .message,
    ).toBe("Scheduling for everyone");
  });

  it("sends only prepared meeting evidence and recipient details to the model", async () => {
    const message = "Confirmed meeting with Guest One at 15:00.";
    authorizeMock.mockResolvedValue({
      turn: { id: TURN_ID, versionId: "cmo-v1", source: "SCHEDULE" },
      grant: { capabilities: [] },
      meetingPrep: true,
    });
    activeRunsMock.mockImplementationOnce(
      async (_, text) => text + " unrelated-background",
    );
    getContextMock.mockResolvedValue({
      version: { id: "cmo-v1", name: "test", systemPrompt: "Be useful." },
      packet: {
        actor: {
          name: "Recipient",
          locale: "de",
          timezone: "Europe/Berlin",
          organizationName: "unrelated-workspace",
        },
        tasks: [{ name: "unrelated-task" }],
        memory: { markdown: "unrelated-memory" },
        recentTurns: [
          {
            source: "CHAT",
            userMessage: "unrelated-history",
            finalAnswer: "unrelated-answer",
            completedAt: new Date().toISOString(),
          },
        ],
      },
    });
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message,
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);
    const call = streamModelCallMock.mock.calls[0]?.[0];
    expect(call.system).toContain("Recipient");
    expect(call.system).toContain("Europe/Berlin");
    expect(call.system).toContain('"locale":"de"');
    expect(call.system).not.toContain("unrelated-");
    expect(call.messages).toEqual([{ role: "user", content: message }]);
    expect(activeRunsMock).not.toHaveBeenCalled();
    expect(cmoTurnPartsMock).not.toHaveBeenCalled();
  });

  it("reports the model and metered usage the drain bills on", async () => {
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });

    await Promise.all(pendingTurns);

    const started = recordedEvents().find((e) => e.type === "step.started");
    const completed = recordedEvents().find((e) => e.type === "step.completed");
    expect(started?.data.modelId).toBe("google/gemini-3.6-flash");
    expect(completed?.data.usage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
      costUsd: 0.0136,
    });
  });

  it("finishes a step that streams for minutes and meters it once", async () => {
    // A non-streamed Gateway call dies at about 60 seconds; this step's
    // answer arrives over two minutes.
    const { streamModelCall } = await vi.importActual<
      typeof import("./stream-model-call")
    >("./stream-model-call");
    const { stepCountIs } = await vi.importActual<typeof import("ai")>("ai");
    const deltas = Array.from({ length: 12 }, (_, index) => ({
      type: "text-delta" as const,
      id: "answer",
      delta: `Week ${index + 1} of the plan. `,
    }));
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunkDelayInMs: 10_000,
          chunks: [
            { type: "text-start" as const, id: "answer" },
            ...deltas,
            { type: "text-end" as const, id: "answer" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage: {
                inputTokens: {
                  total: 20,
                  noCache: 13,
                  cacheRead: 7,
                  cacheWrite: 0,
                },
                outputTokens: { total: 6_000, text: 6_000, reasoning: 0 },
              },
              providerMetadata: { gateway: { cost: "0.05" } },
            },
          ],
        }),
      }),
    });
    streamModelCallMock.mockImplementationOnce((options) =>
      streamModelCall({
        ...options,
        model: behindRegionCheck(model),
        stopWhen: stepCountIs(5),
      }),
    );

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Write the month's strategy",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      });
      await vi.advanceTimersByTimeAsync(150_000);
      await Promise.all(pendingTurns);
    } finally {
      vi.useRealTimers();
    }

    const types = recordedEvents().map((event) => event.type);
    expect(types.filter((type) => type === "step.completed")).toHaveLength(1);
    expect(types).toContain("turn.completed");
    expect(types).not.toContain("turn.failed");
    expect(
      recordedEvents().find((event) => event.type === "step.completed")?.data
        .usage,
    ).toEqual({
      inputTokens: 20,
      outputTokens: 6_000,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
      costUsd: 0.05,
    });
  });

  it("fails the turn fast when the model stream goes silent", async () => {
    const { streamModelCall } = await vi.importActual<
      typeof import("./stream-model-call")
    >("./stream-model-call");
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        // Opens, sends one part, then never sends or closes again.
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "answer" });
          },
        }),
      }),
    });
    streamModelCallMock.mockImplementationOnce((options) =>
      streamModelCall({
        ...options,
        model: behindRegionCheck(model),
        stopWhen: undefined,
      }),
    );

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Write the month's strategy",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      });
      await vi.advanceTimersByTimeAsync(MODEL_STREAM_IDLE_MS + 2_000);
      await Promise.all(pendingTurns);
    } finally {
      vi.useRealTimers();
    }

    expect(
      recordedEvents().find((event) => event.type === "turn.failed")?.data,
    ).toMatchObject({
      code: "ModelStreamStalledError",
      message: new ModelStreamStalledError(MODEL_STREAM_IDLE_MS).message,
    });
    expect(
      recordedEvents().filter((event) => event.type === "step.completed"),
    ).toHaveLength(0);
  });

  it("fails the turn when the model stream reports an error", async () => {
    const { streamModelCall } = await vi.importActual<
      typeof import("./stream-model-call")
    >("./stream-model-call");
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: "error" as const, error: new Error("Overloaded") }],
        }),
      }),
    });
    streamModelCallMock.mockImplementationOnce((options) =>
      streamModelCall({ ...options, model, stopWhen: undefined }),
    );

    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);

    expect(
      recordedEvents().find((event) => event.type === "turn.failed")?.data
        .message,
    ).toBe("Overloaded");
  });

  it.each([
    "create_schedule",
    "post_chat",
    "update_memory",
    "run_integration_tool",
    "upload_file",
  ])(
    "suppresses unsupported success prose for an unused %s grant",
    async (capability) => {
      // The claim check reads the success prose as a claim no receipt backs.
      claimsActionMock.mockResolvedValueOnce(true);
      const withheld = expectCoreLog(
        "warn",
        "Cut a Soko Bot reply's claim of an unconfirmed change",
      );
      authorizeMock.mockResolvedValueOnce({
        turn: { id: TURN_ID, versionId: "v11" },
        grant: { capabilities: [capability] },
      });
      streamModelCallMock.mockResolvedValueOnce({
        text: "Everything was saved and sent successfully.",
        finishReason: "stop",
        steps: [],
        responseMessages: [],
      });
      await new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Perform the synthetic action",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      });
      await Promise.all(pendingTurns);
      expect(
        recordedEvents().find((event) => event.type === "message.completed")
          ?.data.message,
      ).toBe(`Nothing was changed in this turn.\n\n${REPLY_CHECK_NOTES.cut}`);
      expect(withheld[0]?.event).toMatchObject({
        replyChecked: { reason: "claims_unconfirmed_change" },
      });
      expect(executeToolMock).not.toHaveBeenCalled();
    },
  );

  it("preserves conversational prose for genuinely read-only grants", async () => {
    authorizeMock.mockResolvedValueOnce({
      turn: { id: TURN_ID, versionId: "v11" },
      grant: { capabilities: ["get_task_status", "read_memory"] },
    });
    streamModelCallMock.mockResolvedValueOnce({
      text: "What part of the plan would you like to discuss?",
      finishReason: "stop",
      steps: [],
      responseMessages: [],
    });
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Can we discuss the plan?",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);
    expect(
      recordedEvents().find((event) => event.type === "message.completed")?.data
        .message,
    ).toBe("What part of the plan would you like to discuss?");
  });

  it("settles the turn itself, since crons do not run on previews", async () => {
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      reconciliationLeaseToken: "launch-lease",
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });

    await Promise.all(pendingTurns);

    expect(reconcileRuntimeCompletionMock).toHaveBeenCalledWith(
      TURN_ID,
      expect.any(String),
      "launch-lease",
    );
  });

  it("still settles a failed turn so it cannot hang on Thinking", async () => {
    authorizeMock.mockRejectedValue(new Error("boom"));

    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      reconciliationLeaseToken: "launch-lease",
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });

    await Promise.all(pendingTurns);

    expect(reconcileRuntimeCompletionMock).toHaveBeenCalledWith(
      TURN_ID,
      expect.any(String),
      "launch-lease",
    );
  });

  it("offers only the capabilities the turn granted", async () => {
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Hire someone",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });

    await Promise.all(pendingTurns);

    expect(Object.keys(streamModelCallMock.mock.calls[0][0].tools)).toEqual([
      "create_task",
    ]);
  });

  it("fails a tool call that outlives the turn instead of hanging", async () => {
    // A Composio request or slow query used to keep the loop alive past the
    // turn budget until Vercel killed the invocation, leaving the turn on
    // "Thinking…" until the fifteen-minute watchdog.
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Cancel those tasks",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });
    await Promise.all(pendingTurns);

    const tools = streamModelCallMock.mock.calls[0][0].tools;
    executeToolMock.mockImplementation(() => new Promise(() => {}));

    vi.useFakeTimers();
    try {
      const settled = tools.create_task
        .execute({ name: "x" }, { toolCallId: "call_1" })
        .then(
          () => "resolved",
          (error: Error) => error.message,
        );
      await vi.advanceTimersByTimeAsync(95_000);

      await expect(settled).resolves.toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins inference to the version's region", async () => {
    await new InProcessSokoBotRuntime().createSession({
      sessionId: null,
      turnId: TURN_ID,
      message: "Plan the launch",
      userId: "user_1",
      sokoBotId: "bot_1",
      workspaceId: "workspace_1",
    });

    await Promise.all(pendingTurns);

    expect(
      streamModelCallMock.mock.calls[0][0].providerOptions.gateway
        .inferenceRegion,
    ).toEqual({ scope: "zone", geoRegion: "eu" });
    expect(streamModelCallMock.mock.calls[0][0].prepareStep).toEqual(
      expect.any(Function),
    );
  });

  it("records a failed turn instead of throwing into the caller", async () => {
    authorizeMock.mockRejectedValue(new Error("Soko Bot turn is not active"));

    await expect(
      new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Plan the launch",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({ runtimeVersion: "in-process-1" });

    await Promise.all(pendingTurns);

    const failure = recordedEvents().find(
      (event) => event.type === "turn.failed",
    );
    expect(failure?.data.message).toBe("Soko Bot turn is not active");
  });

  describe("turn budget", () => {
    const FIFTEEN_MINUTES = 15 * 60 * 1_000;
    const start = () =>
      new InProcessSokoBotRuntime().createSession({
        sessionId: null,
        turnId: TURN_ID,
        message: "Learn the business",
        userId: "user_1",
        sokoBotId: "bot_1",
        workspaceId: "workspace_1",
      });
    const budgets = () =>
      vi.mocked(AbortSignal.timeout).mock.calls.map(([ms]) => ms);

    beforeEach(() => {
      vi.spyOn(AbortSignal, "timeout");
      vi.mocked(prisma.sokoBotTurn.findUniqueOrThrow).mockResolvedValue({
        createdAt: new Date(),
        parentTurnId: null,
        deadlineAt: new Date(Date.now() + FIFTEEN_MINUTES),
      } as Awaited<ReturnType<typeof prisma.sokoBotTurn.findUniqueOrThrow>>);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.mocked(AbortSignal.timeout).mockRestore();
    });

    // CMO's first read (SOKD-126) needs most of its 15 minutes; a 4-minute
    // budget stopped it at about 10 of 16 Brand Brain sections on every
    // local run.
    it.each(["", "1"])(
      "continues a background brief with its history and original step limit (VERCEL=%s)",
      async (vercel) => {
        vi.stubEnv("VERCEL", vercel);
        const now = Date.now();
        vi.mocked(prisma.sokoBotTurn.findUniqueOrThrow).mockResolvedValueOnce({
          createdAt: new Date(now - 45 * 60_000),
          deadlineAt: new Date(now + FIFTEEN_MINUTES),
          parentTurnId: TURN_ID,
        } as Awaited<ReturnType<typeof prisma.sokoBotTurn.findUniqueOrThrow>>);
        const progress = { role: "assistant", content: "I found the source." };
        streamModelCallMock
          .mockResolvedValueOnce({
            text: progress.content,
            finishReason: "stop",
            steps: [],
            responseMessages: [progress],
          })
          .mockResolvedValueOnce({
            text: "DONE: The sources are ready.",
            finishReason: "stop",
            steps: [],
            responseMessages: [],
          });
        await start();
        await Promise.all(pendingTurns);
        const calls = streamModelCallMock.mock.calls.map(
          ([request]) => request,
        );
        expect(calls).toHaveLength(2);
        expect(calls[0].stopWhen[0]).toBe(160);
        expect(calls[0].model).toBe(calls[1].model);
        expect(calls[1].messages.slice(-2)).toEqual([
          progress,
          { role: "user", content: KEEP_GOING_PROMPT },
        ]);
        expect(
          recordedEvents().find((e) => e.type === "message.completed")?.data
            .message,
        ).toBe("The sources are ready.");
      },
    );

    it.each([
      { parentTurnId: null, prompt: FOREGROUND_TIME_UP_PROMPT },
      { parentTurnId: TURN_ID, prompt: TIME_UP_PROMPT },
    ])(
      "settles a tool-only turn with a metered, tool-free report (parent=$parentTurnId)",
      async ({ parentTurnId, prompt }) => {
        const now = Date.now();
        vi.mocked(prisma.sokoBotTurn.findUniqueOrThrow).mockResolvedValueOnce({
          createdAt: new Date(now),
          deadlineAt: new Date(now + FIFTEEN_MINUTES),
          parentTurnId,
        } as Awaited<ReturnType<typeof prisma.sokoBotTurn.findUniqueOrThrow>>);
        const evidence = {
          role: "assistant",
          content: "First batch recorded.",
        };
        streamModelCallMock
          .mockResolvedValueOnce({
            text: "",
            finishReason: "tool-calls",
            responseMessages: [evidence],
            steps: [
              {
                text: "",
                usage: { inputTokens: 8_000_000 },
                toolResults: [],
                toolCalls: [{ toolName: "create_task", input: {} }],
              },
            ],
          })
          .mockImplementationOnce(async (request) => {
            await request.onStepFinish({
              usage: { inputTokens: 21, outputTokens: 4 },
              reasoning: [],
            });
            return {
              text: "First batch ready.",
              finishReason: "stop",
              steps: [],
              responseMessages: [],
            };
          });
        await start();
        await Promise.all(pendingTurns);
        expect(streamModelCallMock).toHaveBeenCalledTimes(2);
        const report = streamModelCallMock.mock.calls[1][0];
        expect(report.toolChoice).toBe("none");
        expect(report.messages.slice(-2)).toEqual([
          evidence,
          { role: "user", content: prompt },
        ]);
        expect(recordedEvents()).toContainEqual(
          expect.objectContaining({
            type: "step.completed",
            data: expect.objectContaining({
              usage: expect.objectContaining({ inputTokens: 21 }),
            }),
          }),
        );
        expect(
          recordedEvents().find((e) => e.type === "message.completed")?.data
            .message,
        ).toBe("First batch ready.");
      },
    );

    it.each([
      { inputTokens: 21, exhausted: false },
      { inputTokens: 8_000_000, exhausted: true },
    ])(
      "switches Cuso’s short save to the full cache key and honors the remaining budget (exhausted=$exhausted)",
      async ({ inputTokens, exhausted }) => {
        authorizeMock.mockResolvedValueOnce({
          askedByKind: "OWNER",
          turn: { id: TURN_ID, versionId: "cmo-v24", sokoBotId: "bot_1" },
          grant: { capabilities: ["save_strategy"] },
        });
        getContextMock.mockResolvedValueOnce({
          version: {
            id: "cmo-v24",
            name: "Cuso",
            systemPrompt: "Help the owner.",
          },
          packet: {
            workspace: {
              marketing: { organizer: { kind: "question", change: false } },
            },
          },
        });
        streamModelCallMock
          .mockResolvedValueOnce({
            text: "",
            finishReason: "tool-calls",
            responseMessages: [],
            steps: [
              {
                text: "",
                usage: { inputTokens },
                toolResults: [],
                toolCalls: [
                  {
                    toolName: "save_strategy",
                    input: { shortForm: true, what: "move a post" },
                  },
                ],
              },
            ],
          })
          .mockResolvedValueOnce({
            text: "The post is pending.",
            finishReason: "stop",
            steps: [],
            responseMessages: [],
          });
        await start();
        await Promise.all(pendingTurns);
        const calls = streamModelCallMock.mock.calls.map(
          ([request]) => request,
        );
        expect(calls).toHaveLength(2);
        const [short, next] = calls;
        expect(short.tools.save_strategy.inputSchema).not.toBe(
          next.tools.save_strategy.inputSchema,
        );
        const shortKey = short.providerOptions.openai.promptCacheKey;
        const nextKey = next.providerOptions.openai.promptCacheKey;
        expect(shortKey).toMatch(/^cmo-v24:[0-9a-f]{16}$/);
        expect(nextKey).toMatch(/^cmo-v24:[0-9a-f]{16}$/);
        expect(nextKey).not.toBe(shortKey);
        expect(next.toolChoice).toBe(exhausted ? "none" : undefined);
        expect(recordedEvents()).toContainEqual(
          expect.objectContaining({
            type: "message.completed",
            data: expect.objectContaining({ message: "The post is pending." }),
          }),
        );
      },
    );

    it("reuses the metered model and carries only completed observations into a preview report", async () => {
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      const binding = vi
        .spyOn(evaluation, "evaluationBinding")
        .mockReturnValue({
          reservationId: TURN_ID,
          userId: "user_1",
          botId: TURN_ID,
          branch: "fixture",
          sourceSha: "a".repeat(40),
          taskIds: [TURN_ID],
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      try {
        authorizeMock.mockResolvedValueOnce({
          askedByKind: "OWNER",
          turn: { id: TURN_ID, versionId: "v11", chainDepth: 0 },
          grant: { capabilities: ["get_task_status"] },
        });
        vi.mocked(prisma.sokoBotTurn.findUniqueOrThrow).mockResolvedValueOnce({
          createdAt: new Date(now),
          deadlineAt: new Date(now + 100_000),
          parentTurnId: null,
        } as Awaited<ReturnType<typeof prisma.sokoBotTurn.findUniqueOrThrow>>);
        const read = {
          toolName: "get_task_status",
          toolCallId: "read",
          input: { taskId: TURN_ID },
        };
        const observation = { ...read, output: { status: "ready for review" } };
        streamModelCallMock.mockImplementationOnce(async () => {
          clock.mockReturnValue(now + 85_000);
          return {
            text: "",
            finishReason: "tool-calls",
            responseMessages: [
              { role: "assistant", content: "Unverified progress note" },
            ],
            steps: [
              {
                text: "",
                usage: { inputTokens: 21 },
                toolCalls: [read],
                toolResults: [observation],
                content: [{ type: "tool-result", ...observation }],
              },
            ],
          };
        });
        await start();
        await Promise.all(pendingTurns);
        const calls = streamModelCallMock.mock.calls.map(
          ([request]) => request,
        );
        expect(calls).toHaveLength(2);
        expect(calls[1].model).toBe(calls[0].model);
        expect(calls[1].toolChoice).toBe("none");
        const history = JSON.stringify(calls[1].messages);
        expect(history).toContain("Learn the business");
        expect(history).toContain("ready for review");
        expect(history).not.toContain("Unverified progress note");
      } finally {
        binding.mockRestore();
        clock.mockRestore();
      }
    });

    it("uses the foreground time reserve to report from the last tool call", async () => {
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        vi.mocked(prisma.sokoBotTurn.findUniqueOrThrow).mockResolvedValueOnce({
          createdAt: new Date(now),
          deadlineAt: new Date(now + 100_000),
          parentTurnId: null,
        } as Awaited<ReturnType<typeof prisma.sokoBotTurn.findUniqueOrThrow>>);
        streamModelCallMock.mockImplementationOnce(async () => {
          clock.mockReturnValue(now + 85_000);
          return {
            text: "",
            finishReason: "tool-calls",
            steps: [],
            responseMessages: [],
          };
        });
        await start();
        await Promise.all(pendingTurns);
        expect(
          streamModelCallMock.mock.calls.map(([request]) => request.toolChoice),
        ).toEqual([undefined, "none"]);
        expect(
          streamModelCallMock.mock.calls[1][0].messages.at(-1).content,
        ).toBe(FOREGROUND_TIME_UP_PROMPT);
      } finally {
        clock.mockRestore();
      }
    });

    it("runs a local turn until its own deadline", async () => {
      vi.stubEnv("VERCEL", "");

      await start();
      await Promise.all(pendingTurns);

      expect(budgets()).not.toContain(240_000);
      expect(
        budgets().some(
          (ms) => ms > FIFTEEN_MINUTES - 60_000 && ms <= FIFTEEN_MINUTES,
        ),
      ).toBe(true);
    });

    it("stops on Vercel before maxDuration kills the invocation", async () => {
      vi.stubEnv("VERCEL", "1");

      await start();
      await Promise.all(pendingTurns);

      expect(budgets()).toContain(240_000);
    });

    it("fails a turn whose row is gone instead of running unbounded", async () => {
      vi.mocked(prisma.sokoBotTurn.findUniqueOrThrow).mockRejectedValueOnce(
        new Error("No SokoBotTurn found"),
      );

      await start();
      await Promise.all(pendingTurns);

      expect(streamModelCallMock).not.toHaveBeenCalled();
      expect(
        recordedEvents().find((event) => event.type === "turn.failed")?.data
          .message,
      ).toBe("No SokoBotTurn found");
    });
  });

  it("replays recorded events from the requested index", async () => {
    findManyMock.mockResolvedValue([
      {
        startIndex: 2,
        eventId: "evt_2",
        type: "message.completed",
        data: { message: "hi" },
        occurredAt: new Date("2026-08-27T00:00:00.000Z"),
      },
    ]);

    const yielded = [];
    for await (const event of new InProcessSokoBotRuntime().streamEvents({
      sessionId: "sess_1",
      startIndex: 2,
    })) {
      yielded.push(event);
    }

    expect(findManyMock.mock.calls[0][0].where.startIndex).toEqual({ gte: 2 });
    expect(yielded).toEqual([
      {
        startIndex: 2,
        event: {
          type: "message.completed",
          data: { message: "hi" },
          meta: { id: "evt_2", at: "2026-08-27T00:00:00.000Z" },
        },
      },
    ]);
  });
});
