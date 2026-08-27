import type {
  IndexedRuntimeEvent,
  RuntimeEvent,
  SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ SOKO_BOT_CLASSIFIER_MODE: "rules" }),
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

import { SokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

const TURN_ID = "01960001-0001-7001-8001-000000000010";
const LEASE_TOKEN = "lease_1";

function runtimeEvent(
  type: string,
  id: string,
  data: Record<string, unknown> = {},
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
    userId: "user_1",
    workspaceId: "01960001-0001-7001-8001-000000000002",
    eveSessionId: "eve_session_1",
    eveTurnId: "eve_turn_1",
    eveStreamIndex: -1,
    leaseToken: LEASE_TOKEN,
    status: "RUNNING",
    deadlineAt: new Date("2099-08-18T12:00:00.000Z"),
    startedAt: new Date("2026-08-18T11:59:00.000Z"),
    usage: null,
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
    turnFindUniqueMock.mockResolvedValue(activeTurn());
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
      sokoBotEvent: { createMany: eventCreateManyMock },
      sokoBotSchedule: { update: vi.fn() },
      sokoBotScheduleRun: { updateMany: vi.fn() },
      sokoBotTurn: {
        findUnique: turnFindUniqueMock,
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

    const usageWrites = turnUpdateManyMock.mock.calls
      .map(([input]) => input.data.usage)
      .filter(Boolean);
    expect(usageWrites).toHaveLength(2);
    expect(usageWrites.at(-1)).toMatchObject({
      inputTokens: 3,
      costUsd: expect.closeTo(0.3),
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
          finalAnswer: undefined,
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

    const persisted = JSON.stringify({
      events: eventCreateManyMock.mock.calls,
      turns: turnUpdateManyMock.mock.calls,
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
