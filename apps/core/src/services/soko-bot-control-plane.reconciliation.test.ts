import type {
  IndexedRuntimeEvent,
  RuntimeEvent,
  RuntimeJsonValue,
  SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { createGateway } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamModelCall } from "@/lib/soko-bot/stream-model-call";
import { jevRoute } from "@/test/jev-routes";

const {
  botUpdateManyMock,
  eventCreateManyMock,
  eventFindFirstMock,
  recordUsageMock,
  signRequestTokenMock,
  transactionMock,
  turnFindUniqueMock,
  turnFindFirstMock,
  turnUpdateManyMock,
  turnUpdateMock,
} = vi.hoisted(() => ({
  botUpdateManyMock: vi.fn(),
  eventCreateManyMock: vi.fn(),
  eventFindFirstMock: vi.fn(),
  recordUsageMock: vi.fn(),
  signRequestTokenMock: vi.fn(),
  transactionMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
  turnUpdateManyMock: vi.fn(),
  turnUpdateMock: vi.fn(),
}));

const jevEvaluate = vi.hoisted(() => vi.fn());
vi.mock("@/services/turn-action-result-previews.service", () => ({
  prepareTurnActionResultPreviews: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  experimental_evaluate: jevEvaluate,
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_PROACTIVE_PAUSED: false }),
}));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: async () => ({
    disabled: false,
    disabledAt: null,
    disabledReason: null,
  }),
}));
// PostgreSQL's clock is the test clock here.
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    sokoBot: { updateMany: botUpdateManyMock },
    sokoBotEvent: {
      createMany: eventCreateManyMock,
      findFirst: eventFindFirstMock,
    },
    sokoBotTurn: {
      findFirst: turnFindFirstMock,
      findUnique: turnFindUniqueMock,
      updateMany: turnUpdateManyMock,
    },
  },
}));
vi.mock("@/lib/soko-bot/factory", () => ({
  getSokoBotRuntime: vi.fn(),
  getSokoBotTokenService: () =>
    Promise.resolve({ signRequestToken: signRequestTokenMock }),
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotTurnUsage: recordUsageMock,
  requireSokoBotTurnFunding: vi.fn(),
}));

vi.mock("@/lib/soko-bot/action-response", () => ({
  buildActionResponse: vi.fn(async (_tx, _turnId, answerText) => ({
    answerText,
    appliedReceiptIds: [],
    observations: [],
    unfulfilledActions: [],
  })),
}));
vi.mock("@/services/soko-bot-outcome.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/soko-bot-outcome.service")
  >()),
  assessSokoBotIntentOutcome: vi.fn(),
  invalidateSokoBotIntentOutcomes: vi.fn(),
}));
vi.mock("@/services/soko-bot-delivery.service", () => ({
  enqueueSokoBotDelivery: vi.fn(),
  deliverSokoBotTurnOutbox: vi.fn().mockResolvedValue(undefined),
}));

import { SokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

const TURN_ID = "01960001-0001-7001-8001-000000000010";
const LEASE_TOKEN = "lease_1";

function runtimeEvent(
  type: string,
  id: string,
  data: Record<string, RuntimeJsonValue> = {},
): RuntimeEvent {
  return {
    type,
    data,
    meta: { id, at: "2026-08-18T12:00:00.000Z" },
  };
}

function activeTurn(overrides: Record<string, unknown> = {}) {
  return {
    id: TURN_ID,
    sokoBotId: "01960001-0001-7001-8001-000000000001",
    requestedByUserId: "user_1",
    workspaceId: "01960001-0001-7001-8001-000000000002",
    eveSessionId: "eve_session_1",
    eveTurnId: "eve_turn_1",
    eveStreamIndex: -1,
    leaseToken: LEASE_TOKEN,
    status: "RUNNING",
    deadlineAt: new Date("2099-08-18T12:00:00.000Z"),
    startedAt: new Date("2026-08-18T11:59:00.000Z"),
    usage: null as unknown,
    costUsdMicros: 0n,
    errorKind: null,
    errorDetail: null,
    cancellationRequestedAt: null,
    scheduleRun: null,
    ...overrides,
  };
}

function runtimeFor(
  events: readonly IndexedRuntimeEvent[],
  cancelTurn = vi.fn(),
): SokoBotRuntime {
  return {
    createSession: vi.fn(),
    streamEvents: vi.fn(async function* () {
      for (const event of events) yield event;
    }),
    cancelTurn,
    resetSession: vi.fn(),
    inspectSession: vi.fn(),
  };
}

// Jev answers every classification; tests that need another route script it.
beforeEach(() => {
  jevEvaluate.mockResolvedValue(jevRoute("DIRECT_RESPONSE"));
});

describe("SokoBotControlPlane reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const seenEvents = new Set<string>();
    eventCreateManyMock.mockImplementation(async ({ data }) => {
      const id = data[0]?.eveEventId;
      if (seenEvents.has(id)) return { count: 0 };
      seenEvents.add(id);
      return { count: 1 };
    });
    eventFindFirstMock.mockResolvedValue(null);
    // The locked row: usage is read back from what earlier steps wrote.
    let row = activeTurn();
    turnFindUniqueMock.mockImplementation(async () => row);
    turnUpdateMock.mockImplementation(async ({ data }) => {
      row = { ...row, ...data };
      return row;
    });
    turnFindFirstMock.mockResolvedValue(null);
    turnUpdateManyMock.mockResolvedValue({ count: 1 });
    botUpdateManyMock.mockResolvedValue({ count: 1 });
    recordUsageMock.mockResolvedValue({
      chargedCents: 0n,
      expectedCents: 0n,
      shortfall: false,
    });
    signRequestTokenMock.mockResolvedValue("request-token");
    const tx = {
      sokoBot: { updateMany: botUpdateManyMock },
      // No persisted settlement trigger unless a test adds one.
      sokoBotEvent: {
        createMany: eventCreateManyMock,
        findMany: async () => [],
      },
      sokoBotSchedule: { update: vi.fn() },
      sokoBotScheduleRun: { updateMany: vi.fn() },
      sokoBotTurn: {
        findUnique: turnFindUniqueMock,
        update: turnUpdateMock,
        updateMany: turnUpdateManyMock,
      },
    };
    transactionMock.mockImplementation(async (callback) => callback(tx));
  });

  it("does not double-count a replayed usage event", async () => {
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("step.completed", "usage_1", {
          usage: { inputTokens: 1, costUsd: 0.1 },
        }),
      },
      {
        startIndex: 1,
        event: runtimeEvent("step.completed", "usage_1", {
          usage: { inputTokens: 1, costUsd: 0.1 },
        }),
      },
      {
        startIndex: 2,
        event: runtimeEvent("step.completed", "usage_2", {
          usage: { inputTokens: 2, costUsd: 0.2 },
        }),
      },
      { startIndex: 3, event: runtimeEvent("turn.completed", "done_1") },
      { startIndex: 4, event: runtimeEvent("session.waiting", "wait_1") },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    const usageWrites = turnUpdateMock.mock.calls
      .map(([input]) => input.data.usage)
      .filter(Boolean);
    expect(usageWrites).toHaveLength(2);
    expect(usageWrites.at(-1)).toMatchObject({
      inputTokens: 3,
      costUsd: expect.closeTo(0.3),
    });
  });

  it("keeps the turn's spend split by source", async () => {
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("step.completed", "model_1", {
          modelId: "openai/gpt",
          usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.02 },
        }),
      },
      {
        startIndex: 1,
        event: runtimeEvent("step.completed", "exa_1", {
          modelId: "exa/search",
          usage: { costUsd: 0.007 },
        }),
      },
      {
        startIndex: 2,
        event: runtimeEvent("step.completed", "model_2", {
          modelId: "openai/gpt",
          usage: { inputTokens: 5, outputTokens: 1, costUsd: 0.01 },
        }),
      },
      { startIndex: 3, event: runtimeEvent("turn.completed", "done_1") },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    const usage = turnUpdateMock.mock.calls
      .map(([input]) => input.data.usage)
      .filter(Boolean)
      .at(-1);
    expect(usage).toMatchObject({
      costUsd: expect.closeTo(0.037),
      bySource: {
        "openai/gpt": {
          calls: 2,
          inputTokens: 15,
          outputTokens: 3,
          costUsd: expect.closeTo(0.03),
        },
        "exa/search": { calls: 1, costUsd: expect.closeTo(0.007) },
      },
    });
  });

  it("cancels and fails unsupported Eve input requests without hanging", async () => {
    const cancelTurn = vi.fn().mockResolvedValue(undefined);
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("input.requested", "input_1", {
          requestId: "eve_input_1",
        }),
      },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events, cancelTurn),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(cancelTurn).toHaveBeenCalledWith({
      sessionId: "eve_session_1",
      eveTurnId: "eve_turn_1",
    });
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorKind: "runtime_input_unsupported",
          finalAnswer: null,
        }),
      }),
    );
    expect(botUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ERROR",
          eveSessionId: null,
        }),
      }),
    );
  });

  it("preserves completed output when settlement discovers a credit shortfall", async () => {
    turnFindUniqueMock.mockResolvedValue(
      activeTurn({ finalAnswer: "Delegation complete" }),
    );
    recordUsageMock.mockResolvedValue({
      chargedCents: 10n,
      expectedCents: 20n,
      shortfall: true,
    });
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("message.completed", "message_1", {
          message: "Delegation complete",
        }),
      },
      { startIndex: 1, event: runtimeEvent("turn.completed", "done_1") },
      { startIndex: 2, event: runtimeEvent("session.waiting", "wait_1") },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          errorKind: "insufficient_credits",
          finalAnswer: "Delegation complete",
        }),
      }),
    );
    expect(botUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "IDLE",
          consecutiveTurnFailures: 0,
        }),
      }),
    );
  });

  it.each([
    [["API key budget exceeded. Limit: $400."], "ai_budget_exceeded"],
    [["Team budget exceeded. Limit: $1000."], "ai_budget_exceeded"],
    [["Temporary upstream failure"], "GatewayInternalServerError"],
    [
      ["Temporary upstream failure", "API key budget exceeded. Limit: $400."],
      "ai_budget_exceeded",
    ],
    [
      ["Team budget exceeded. Limit: $1000.", "Temporary upstream failure"],
      "AI_RetryError",
    ],
  ])("settles a failed Gateway turn for %j", async (messages, errorKind) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const message of messages) {
      fetch.mockResolvedValueOnce(
        Response.json(
          { error: { type: "internal_server_error", message } },
          { status: 500, headers: { "retry-after-ms": "0" } },
        ),
      );
    }
    const gateway = createGateway({
      apiKey: "test-key",
      fetch,
    });
    const runtime = runtimeFor([]);
    runtime.streamEvents = vi.fn(async function* () {
      try {
        await streamModelCall({
          model: gateway("google/gemini-3.6-flash"),
          prompt: "Plan the launch",
          maxRetries: messages.length - 1,
        });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        yield {
          startIndex: 0,
          event: runtimeEvent("turn.failed", "failed_1", {
            code: error.name,
            message: error.message,
          }),
        };
        yield {
          startIndex: 1,
          event: runtimeEvent("session.waiting", "wait_1"),
        };
      }
    });

    await new SokoBotControlPlane(runtime, undefined, undefined).reconcileTurn(
      TURN_ID,
      undefined,
      LEASE_TOKEN,
    );

    expect(fetch).toHaveBeenCalledTimes(messages.length);
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorKind,
          errorDetail:
            errorKind === "ai_budget_exceeded"
              ? "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets."
              : errorKind === "AI_RetryError"
                ? "Failed after 2 attempts. Last error: GatewayInternalServerError: Temporary upstream failure"
                : messages[0],
        }),
      }),
    );
  });

  it("redacts provider secrets before persisting failure events or turn errors", async () => {
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("turn.failed", "failed_1", {
          code: "password=provider-secret",
          message: "Bearer provider-token-123456789",
        }),
      },
      { startIndex: 1, event: runtimeEvent("session.waiting", "wait_1") },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    // The failure event writes the turn's diagnostics while it is active.
    const activeErrorWrite = turnUpdateMock.mock.calls
      .map(([input]) => input.data)
      .find((data) => data.errorKind !== undefined);
    expect(activeErrorWrite?.errorKind).toContain("[Sensitive value removed]");
    expect(activeErrorWrite?.errorDetail).toContain(
      "[Sensitive value removed]",
    );
    const persisted = JSON.stringify({
      events: eventCreateManyMock.mock.calls,
      turns: turnUpdateManyMock.mock.calls,
      activeTurns: turnUpdateMock.mock.calls,
    });
    expect(persisted).not.toContain("provider-secret");
    expect(persisted).not.toContain("provider-token-123456789");
    expect(persisted).toContain("[Sensitive value removed]");
  });

  it("redacts secrets from interrupted runtime stream diagnostics", async () => {
    const runtime = runtimeFor([]);
    runtime.streamEvents = vi.fn(async function* () {
      throw new Error("password=stream-provider-secret");
    });

    await expect(
      new SokoBotControlPlane(runtime, undefined, undefined).reconcileTurn(
        TURN_ID,
        undefined,
        LEASE_TOKEN,
      ),
    ).rejects.toThrow("stream-provider-secret");

    expect(turnUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorKind: "runtime_stream_interrupted",
          errorDetail: "[Sensitive value removed]",
        }),
      }),
    );
  });

  it("redelivers cancellation for an already-bound turn", async () => {
    const cancelTurn = vi.fn().mockResolvedValue(undefined);
    turnFindUniqueMock.mockResolvedValue(
      activeTurn({
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: new Date("2026-08-18T11:59:00.000Z"),
      }),
    );

    await new SokoBotControlPlane(
      runtimeFor([], cancelTurn),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(cancelTurn).toHaveBeenCalledWith({
      sessionId: "eve_session_1",
      eveTurnId: "eve_turn_1",
    });
  });

  it("redelivers cancellation as soon as an unbound Eve turn is identified", async () => {
    const cancelTurn = vi.fn().mockResolvedValue(undefined);
    turnFindUniqueMock.mockResolvedValue(
      activeTurn({
        status: "CANCEL_REQUESTED",
        eveTurnId: null,
        userMessage: "repeat this",
        cancellationRequestedAt: new Date("2026-08-18T11:59:00.000Z"),
      }),
    );
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("turn.started", "started_1", {
          turnId: "eve_turn_new",
        }),
      },
      {
        startIndex: 1,
        event: runtimeEvent("message.received", "received_1", {
          turnId: "eve_turn_new",
          message: "repeat this",
        }),
      },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events, cancelTurn),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(cancelTurn).toHaveBeenCalledWith({
      sessionId: "eve_session_1",
      eveTurnId: "eve_turn_new",
    });
  });

  it("observes cancellation requested while an unbound turn is being identified", async () => {
    const cancelTurn = vi.fn().mockResolvedValue(undefined);
    turnFindUniqueMock
      .mockResolvedValueOnce(
        activeTurn({
          status: "RUNNING",
          eveTurnId: null,
          userMessage: "repeat this",
        }),
      )
      .mockResolvedValue(
        activeTurn({
          status: "CANCEL_REQUESTED",
          eveTurnId: "eve_turn_new",
          userMessage: "repeat this",
          cancellationRequestedAt: new Date("2026-08-18T11:59:00.000Z"),
        }),
      );
    const events = [
      {
        startIndex: 0,
        event: runtimeEvent("turn.started", "started_1", {
          turnId: "eve_turn_new",
        }),
      },
      {
        startIndex: 1,
        event: runtimeEvent("message.received", "received_1", {
          turnId: "eve_turn_new",
          message: "repeat this",
        }),
      },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events, cancelTurn),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(cancelTurn).toHaveBeenCalledWith({
      sessionId: "eve_session_1",
      eveTurnId: "eve_turn_new",
    });
  });

  it("lets cancellation win over a later provider completion", async () => {
    turnFindUniqueMock.mockResolvedValue(
      activeTurn({
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: new Date("2026-08-18T11:59:59.000Z"),
      }),
    );
    const events = [
      { startIndex: 0, event: runtimeEvent("turn.completed", "done_1") },
      { startIndex: 1, event: runtimeEvent("session.waiting", "wait_1") },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("preserves a provider completion that predates cancellation", async () => {
    turnFindUniqueMock.mockResolvedValue(
      activeTurn({
        status: "CANCEL_REQUESTED",
        cancellationRequestedAt: new Date("2026-08-18T12:00:01.000Z"),
      }),
    );
    const events = [
      { startIndex: 0, event: runtimeEvent("turn.completed", "done_1") },
      { startIndex: 1, event: runtimeEvent("session.waiting", "wait_1") },
    ];

    await new SokoBotControlPlane(
      runtimeFor(events),
      undefined,
      undefined,
    ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN);

    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });
});

describe("reconciling a turn another reconciler already settled", () => {
  // Two callers start the same clientTurnId: the duplicate gets the lease
  // the first one holds, and the first settles the turn and clears it.
  it("returns without touching the runtime", async () => {
    vi.clearAllMocks();
    turnFindUniqueMock.mockResolvedValue(
      activeTurn({ status: "COMPLETED", leaseToken: null }),
    );
    const runtime = runtimeFor([]);

    await new SokoBotControlPlane(runtime, undefined, undefined).reconcileTurn(
      TURN_ID,
      undefined,
      LEASE_TOKEN,
    );

    expect(runtime.streamEvents).not.toHaveBeenCalled();
    expect(turnUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("reconciling a turn whose first caller is still starting it", () => {
  // The duplicate reads the turn before the first caller's runtime has
  // acknowledged it: STARTING, lease held, no session yet.
  function firstStart(overrides: Record<string, unknown> = {}) {
    return activeTurn({
      status: "STARTING",
      eveSessionId: null,
      eveTurnId: null,
      createdAt: new Date(),
      reconcilerHeartbeatAt: null,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    });
  }

  it("returns without touching the runtime", async () => {
    vi.clearAllMocks();
    turnFindUniqueMock.mockResolvedValue(firstStart());
    const runtime = runtimeFor([]);

    await new SokoBotControlPlane(runtime, undefined, undefined).reconcileTurn(
      TURN_ID,
      undefined,
      LEASE_TOKEN,
    );

    expect(runtime.streamEvents).not.toHaveBeenCalled();
    expect(turnUpdateManyMock).not.toHaveBeenCalled();
  });

  // Nobody reconciles these after the duplicate returns, so it must say so.
  it.each([
    [
      "a recovery worker claimed",
      {
        reconcilerHeartbeatAt: new Date(),
        errorKind: "runtime_start_ambiguous",
      },
    ],
    ["whose lease expired", { leaseExpiresAt: new Date(Date.now() - 1_000) }],
  ])("still throws for a start %s", async (_label, overrides) => {
    vi.clearAllMocks();
    turnFindUniqueMock.mockResolvedValue(firstStart(overrides));

    await expect(
      new SokoBotControlPlane(
        runtimeFor([]),
        undefined,
        undefined,
      ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN),
    ).rejects.toThrow("Runtime turn not found");
  });

  it("still throws for a running turn that lost its session", async () => {
    vi.clearAllMocks();
    turnFindUniqueMock.mockResolvedValue(activeTurn({ eveSessionId: null }));

    await expect(
      new SokoBotControlPlane(
        runtimeFor([]),
        undefined,
        undefined,
      ).reconcileTurn(TURN_ID, undefined, LEASE_TOKEN),
    ).rejects.toThrow("Runtime turn not found");
  });
});

describe("reconciling beside another writer under the same lease", () => {
  // The in-process loop's settle and an admin retry reconcile under the
  // lease the row holds, beside whoever already drains it.
  let row: ReturnType<typeof activeTurn>;

  beforeEach(() => {
    vi.clearAllMocks();
    row = activeTurn();
    eventFindFirstMock.mockResolvedValue(null);
    eventCreateManyMock.mockResolvedValue({ count: 1 });
    turnFindUniqueMock.mockImplementation(async () => row);
    turnUpdateMock.mockImplementation(async ({ data }) => {
      row = { ...row, ...data };
      return row;
    });
    // Applies each conditional write to the row, as PostgreSQL would.
    turnUpdateManyMock.mockImplementation(async ({ where, data }) => {
      const matches =
        (where.leaseToken === undefined ||
          where.leaseToken === row.leaseToken) &&
        (where.eveStreamIndex === undefined ||
          row.eveStreamIndex < where.eveStreamIndex.lt);
      if (!matches) return { count: 0 };
      row = { ...row, ...data };
      return { count: 1 };
    });
    transactionMock.mockImplementation(async (callback) =>
      callback({
        sokoBotEvent: {
          createMany: eventCreateManyMock,
          findMany: async () => [],
        },
        sokoBotTurn: {
          findUnique: turnFindUniqueMock,
          update: turnUpdateMock,
          updateMany: turnUpdateManyMock,
        },
      }),
    );
  });

  it("adds its step to the totals the other writer committed", async () => {
    const runtime = runtimeFor([]);
    vi.mocked(runtime.streamEvents).mockImplementation(async function* () {
      yield {
        startIndex: 0,
        event: runtimeEvent("step.completed", "step_a", {
          usage: { inputTokens: 1, costUsd: 0.1 },
        }),
      };
      // The other writer commits its own step before this one's next write.
      row = {
        ...row,
        usage: { ...(row.usage as object), inputTokens: 3 },
        costUsdMicros: (row.costUsdMicros ?? 0n) + 200_000n,
      };
      yield {
        startIndex: 2,
        event: runtimeEvent("step.completed", "step_c", {
          usage: { inputTokens: 4, costUsd: 0.4 },
        }),
      };
    });

    await new SokoBotControlPlane(runtime, undefined, undefined).reconcileTurn(
      TURN_ID,
      undefined,
      LEASE_TOKEN,
    );

    expect(row.costUsdMicros).toBe(700_000n);
    expect(row.usage).toMatchObject({ inputTokens: 7 });
  });

  it("never moves the cursor back past what the other writer reached", async () => {
    row = activeTurn({ eveStreamIndex: 5 });
    const runtime = runtimeFor([
      {
        startIndex: 3,
        event: runtimeEvent("message.completed", "msg_3", {
          message: "replayed",
        }),
      },
    ]);
    eventCreateManyMock.mockResolvedValue({ count: 0 });

    await new SokoBotControlPlane(runtime, undefined, undefined).reconcileTurn(
      TURN_ID,
      undefined,
      LEASE_TOKEN,
    );

    // The replayed event was fenced, found already stored, and left the
    // cursor where the other writer put it.
    expect(eventCreateManyMock).toHaveBeenCalledTimes(1);
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TURN_ID, eveStreamIndex: { lt: 3 } },
      }),
    );
    expect(row.eveStreamIndex).toBe(5);
  });
});
