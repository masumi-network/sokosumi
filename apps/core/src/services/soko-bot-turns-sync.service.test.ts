import { SokoBotTurnStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  expireTurnMock,
  getEnvMock,
  recoverStartingTurnMock,
  reconcileTurnMock,
  settleUndeliverableCancellationMock,
  turnFindManyMock,
  turnUpdateManyMock,
} = vi.hoisted(() => ({
  expireTurnMock: vi.fn(),
  getEnvMock: vi.fn(),
  recoverStartingTurnMock: vi.fn(),
  reconcileTurnMock: vi.fn(),
  settleUndeliverableCancellationMock: vi.fn(),
  turnFindManyMock: vi.fn(),
  turnUpdateManyMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
// PostgreSQL's clock is the test clock here.
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => new Date(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (run: (tx: object) => unknown) =>
      run({
        $queryRaw: vi.fn(),
        sokoBotTurn: { updateMany: turnUpdateManyMock },
      }),
    sokoBotTurn: {
      findMany: turnFindManyMock,
    },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  ACTIVE_TURN_STATUSES: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"],
  TURN_LEASE_MS: 16 * 60_000,
  staleTurnLeaseWhere: () => ({}),
  startRecoveryEligibility: () => ({}),
  sokoBotControlPlane: {
    expireTurn: expireTurnMock,
    recoverStartingTurn: recoverStartingTurnMock,
    reconcileTurn: reconcileTurnMock,
    settleUndeliverableCancellation: settleUndeliverableCancellationMock,
  },
}));

import { sokoBotTurnsSyncService } from "@/services/soko-bot-turns-sync.service";
import { expectCoreLog } from "@/test/core-log";

function continueFor(maxChecks: number) {
  let checks = 0;
  return () => checks++ < maxChecks;
}

const staleHeartbeat = new Date("2026-08-17T11:00:00.000Z");

describe("SokoBotTurnsSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    turnFindManyMock.mockResolvedValue([]);
    turnUpdateManyMock.mockResolvedValue({ count: 1 });
    expireTurnMock.mockResolvedValue(true);
    recoverStartingTurnMock.mockResolvedValue({ turnId: "recovered" });
    reconcileTurnMock.mockResolvedValue(undefined);
    settleUndeliverableCancellationMock.mockResolvedValue(true);
  });

  it("does nothing while Soko Bot is disabled", async () => {
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: false });

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result).toEqual({
      claimed: 0,
      reconciled: 0,
      expired: 0,
      interrupted: 0,
    });
    expect(turnFindManyMock).not.toHaveBeenCalled();
  });

  it("looks only at the named bots' turns when given some", async () => {
    turnFindManyMock.mockResolvedValue([]);

    await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
      sokoBotIds: ["bot_1", "bot_2"],
    });

    expect(turnFindManyMock).toHaveBeenCalledTimes(4);
    for (const [query] of turnFindManyMock.mock.calls)
      expect(query.where.sokoBotId).toEqual({ in: ["bot_1", "bot_2"] });
  });

  it("expires overdue turns and releases their lease", async () => {
    turnFindManyMock.mockResolvedValueOnce([{ id: "turn_1" }]);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: continueFor(1),
    });

    expect(result.expired).toBe(1);
    expect(expireTurnMock).toHaveBeenCalledWith("turn_1");
    expect(reconcileTurnMock).not.toHaveBeenCalled();
  });

  it("promptly settles a cancellation that never received an Eve session", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "turn_cancelled_before_acceptance" }]);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result.expired).toBe(1);
    expect(settleUndeliverableCancellationMock).toHaveBeenCalledWith(
      "turn_cancelled_before_acceptance",
    );
    expect(recoverStartingTurnMock).not.toHaveBeenCalled();
    expect(turnFindManyMock.mock.calls[1]?.[0]).toMatchObject({
      where: {
        status: SokoBotTurnStatus.CANCEL_REQUESTED,
        eveSessionId: null,
      },
    });
  });

  it("recovers abandoned STARTING turns that never received a session", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "turn_abandoned" }]);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result).toEqual({
      claimed: 1,
      reconciled: 1,
      expired: 0,
      interrupted: 0,
    });
    expect(recoverStartingTurnMock).toHaveBeenCalledWith("turn_abandoned");
    expect(expireTurnMock).not.toHaveBeenCalled();
  });

  it("only selects no-session STARTING turns for durable replay", async () => {
    await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: continueFor(3),
    });

    const abandonQuery = turnFindManyMock.mock.calls[2]?.[0] as {
      where: { eveSessionId: null };
    };
    expect(abandonQuery.where.eveSessionId).toBeNull();
  });

  it("claims and resumes a stale active turn", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "turn_2",
          eveSessionId: "session_2",
          leaseToken: "old_lease",
          reconcilerHeartbeatAt: staleHeartbeat,
        },
      ]);
    const abortSignal = new AbortController().signal;

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal,
      shouldContinue: () => true,
    });

    expect(result).toEqual({
      claimed: 1,
      reconciled: 1,
      expired: 0,
      interrupted: 0,
    });
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      "turn_2",
      abortSignal,
      expect.any(String),
    );
    expect(turnUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "turn_2",
        eveSessionId: "session_2",
        leaseToken: "old_lease",
        deadlineAt: { gt: expect.any(Date) },
        status: {
          in: [
            SokoBotTurnStatus.QUEUED,
            SokoBotTurnStatus.STARTING,
            SokoBotTurnStatus.RUNNING,
            SokoBotTurnStatus.CANCEL_REQUESTED,
          ],
        },
        reconcilerHeartbeatAt: staleHeartbeat,
      },
      data: expect.objectContaining({
        leaseToken: expect.any(String),
        leaseExpiresAt: expect.any(Date),
        reconcilerHeartbeatAt: expect.any(Date),
      }),
    });
  });

  it("does not hijack a turn when another worker wins the lease compare-and-set", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "turn_cas", reconcilerHeartbeatAt: staleHeartbeat },
      ]);
    turnUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result.claimed).toBe(0);
    expect(reconcileTurnMock).not.toHaveBeenCalled();
  });

  it("reconciles a claimed batch concurrently", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "turn_a", reconcilerHeartbeatAt: staleHeartbeat },
        { id: "turn_b", reconcilerHeartbeatAt: staleHeartbeat },
      ]);

    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    reconcileTurnMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight -= 1;
    });

    const pending = sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });
    await vi.waitFor(() => expect(reconcileTurnMock).toHaveBeenCalledTimes(2));
    expect(maxInFlight).toBe(2);
    release();
    const result = await pending;

    expect(result).toEqual({
      claimed: 2,
      reconciled: 2,
      expired: 0,
      interrupted: 0,
    });
  });

  it("records an interrupted resume without terminally settling the turn", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not resume a stalled Soko Bot turn",
    );
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "turn_3", reconcilerHeartbeatAt: staleHeartbeat },
      ]);
    reconcileTurnMock.mockRejectedValue(
      Object.assign(
        new Error(
          'stream disconnected while echoing "Subject: Confidential merger" sk_live_abc123',
        ),
        {
          name: "Confidential merger with Acme",
          // An upper-case secret in the code: not a known machine code.
          code: "AKIAIOSFODNN7EXAMPLE",
          status: 502,
          details: { operation: "sk_live_abc123" },
        },
      ),
    );

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result.interrupted).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(expireTurnMock).not.toHaveBeenCalled();
    expect(warnings[0]).toMatchObject({ why: "Turn reconciliation threw" });
    expect(warnings[0]?.event).toMatchObject({
      failure: { errorName: "Error", status: 502 },
    });
    const drained = JSON.stringify(warnings[0]?.event);
    expect(drained).not.toContain("Confidential merger");
    expect(drained).not.toContain("sk_live");
    expect(drained).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(warnings[0]?.event).toMatchObject({ turn: { id: "turn_3" } });
  });

  it("stops claiming further stale turns when shouldContinue flips", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "turn_keep", reconcilerHeartbeatAt: staleHeartbeat },
        { id: "turn_skip", reconcilerHeartbeatAt: staleHeartbeat },
      ]);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: continueFor(5),
    });

    expect(result.claimed).toBe(1);
    expect(reconcileTurnMock).toHaveBeenCalledTimes(1);
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      "turn_keep",
      expect.any(AbortSignal),
      expect.any(String),
    );
  });
});
