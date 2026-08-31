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
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findMany: turnFindManyMock,
      updateMany: turnUpdateManyMock,
    },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SOKO_BOT_START_RECOVERY_GRACE_MS: 120_000,
  sokoBotControlPlane: {
    expireTurn: expireTurnMock,
    recoverStartingTurn: recoverStartingTurnMock,
    reconcileTurn: reconcileTurnMock,
    settleUndeliverableCancellation: settleUndeliverableCancellationMock,
  },
}));

import {
  SOKO_BOT_TURN_STALE_HEARTBEAT_MS,
  SOKO_BOT_TURN_STARTING_ABANDON_MS,
  SOKO_BOT_TURN_STARTING_GRACE_MS,
  sokoBotTurnsSyncService,
} from "@/services/soko-bot-turns-sync.service";

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

  it("does not claim a fresh STARTING turn with a null heartbeat", async () => {
    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result.claimed).toBe(0);
    const staleQuery = turnFindManyMock.mock.calls[3]?.[0] as {
      where: {
        NOT: { status: string; createdAt: { gt: Date } };
        OR: Array<Record<string, unknown>>;
      };
    };
    expect(staleQuery.where.NOT).toEqual({
      status: SokoBotTurnStatus.STARTING,
      createdAt: { gt: expect.any(Date) },
    });
    expect(staleQuery.where.OR).toEqual([
      { reconcilerHeartbeatAt: { lte: expect.any(Date) } },
      {
        reconcilerHeartbeatAt: null,
        status: { not: SokoBotTurnStatus.STARTING },
      },
      {
        reconcilerHeartbeatAt: null,
        status: SokoBotTurnStatus.STARTING,
        createdAt: { lte: expect.any(Date) },
      },
    ]);
    const graceCutoff = staleQuery.where.NOT.createdAt.gt.getTime();
    expect(Date.now() - graceCutoff).toBeGreaterThanOrEqual(
      SOKO_BOT_TURN_STARTING_GRACE_MS - 50,
    );
    const staleCutoff = (
      staleQuery.where.OR[0] as { reconcilerHeartbeatAt: { lte: Date } }
    ).reconcilerHeartbeatAt.lte.getTime();
    expect(Date.now() - staleCutoff).toBeGreaterThanOrEqual(
      SOKO_BOT_TURN_STALE_HEARTBEAT_MS - 50,
    );
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
    const abandonQuery = turnFindManyMock.mock.calls[2]?.[0] as {
      where: {
        status: string;
        eveSessionId: null;
        createdAt: { lte: Date };
      };
    };
    expect(abandonQuery.where).toEqual(
      expect.objectContaining({
        status: SokoBotTurnStatus.STARTING,
        eveSessionId: null,
        reconcilerHeartbeatAt: null,
      }),
    );
    const abandonCutoff = abandonQuery.where.createdAt.lte.getTime();
    expect(Date.now() - abandonCutoff).toBeGreaterThanOrEqual(
      SOKO_BOT_TURN_STARTING_ABANDON_MS - 50,
    );
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
        { id: "turn_2", reconcilerHeartbeatAt: staleHeartbeat },
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

  it("claims a session-bound STARTING turn after its acknowledgement grace", async () => {
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "turn_starting", reconcilerHeartbeatAt: null },
      ]);

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result.claimed).toBe(1);
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      "turn_starting",
      expect.any(AbortSignal),
      expect.any(String),
    );
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
    turnFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "turn_3", reconcilerHeartbeatAt: staleHeartbeat },
      ]);
    reconcileTurnMock.mockRejectedValue(new Error("stream disconnected"));

    const result = await sokoBotTurnsSyncService.syncActiveTurns({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });

    expect(result.interrupted).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(expireTurnMock).not.toHaveBeenCalled();
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
