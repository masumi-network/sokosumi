import { beforeEach, describe, expect, it, vi } from "vitest";

const pendingTurns: Promise<unknown>[] = [];

const {
  authorizeMock,
  createManyMock,
  executeToolMock,
  findFirstMock,
  findManyMock,
  generateTextMock,
  getContextMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  createManyMock: vi.fn(),
  executeToolMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  generateTextMock: vi.fn(),
  getContextMock: vi.fn(),
  // The real waitUntil detaches the turn, so tests await the captured promise.
  waitUntilMock: vi.fn((promise: Promise<unknown>) => {
    pendingTurns.push(promise);
  }),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: waitUntilMock }));
vi.mock("ai", () => ({
  generateText: generateTextMock,
  stepCountIs: (count: number) => count,
  tool: (definition: unknown) => definition,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotRuntimeEvent: {
      createMany: createManyMock,
      findFirst: findFirstMock,
      findMany: findManyMock,
      deleteMany: vi.fn(),
    },
    sokoBotTurn: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: {
    authorize: authorizeMock,
    getContext: getContextMock,
    executeTool: executeToolMock,
  },
}));

import { InProcessSokoBotRuntime } from "./in-process-runtime";

const TURN_ID = "01960001-0001-7001-8001-000000000001";

function recordedEvents(): { type: string; data: Record<string, unknown> }[] {
  return createManyMock.mock.calls.map((call) => call[0].data[0]);
}

describe("InProcessSokoBotRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingTurns.length = 0;
    findFirstMock.mockResolvedValue(null);
    authorizeMock.mockResolvedValue({
      turn: { id: TURN_ID, versionId: "v11" },
      grant: { capabilities: ["create_task"] },
    });
    getContextMock.mockResolvedValue({
      version: { id: "v11", name: "v11 test", systemPrompt: "Be useful." },
      packet: { memory: { version: 1 } },
    });
    generateTextMock.mockResolvedValue({
      text: "Delegated to a Coworker.",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it("runs the turn and records the events the drain settles on", async () => {
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
      "message.completed",
      "turn.completed",
      "session.waiting",
    ]);
    const completed = recordedEvents().find(
      (event) => event.type === "message.completed",
    );
    expect(completed?.data.message).toBe("Delegated to a Coworker.");
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

    expect(Object.keys(generateTextMock.mock.calls[0][0].tools)).toEqual([
      "create_task",
    ]);
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
      generateTextMock.mock.calls[0][0].providerOptions.gateway.inferenceRegion,
    ).toEqual({ scope: "zone", geoRegion: "eu" });
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
