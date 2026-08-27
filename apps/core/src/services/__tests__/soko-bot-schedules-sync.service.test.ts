import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  computeNextRunMock,
  dueScheduleFindFirstMock,
  getEnvMock,
  reconcileTurnMock,
  runCreateMock,
  runFindFirstMock,
  runUpdateManyMock,
  scheduleUpdateMock,
  scheduleUpdateManyMock,
  startTurnMock,
  transactionMock,
  turnFindUniqueMock,
} = vi.hoisted(() => ({
  computeNextRunMock: vi.fn(),
  dueScheduleFindFirstMock: vi.fn(),
  getEnvMock: vi.fn(),
  reconcileTurnMock: vi.fn(),
  runCreateMock: vi.fn(),
  runFindFirstMock: vi.fn(),
  runUpdateManyMock: vi.fn(),
  scheduleUpdateMock: vi.fn(),
  scheduleUpdateManyMock: vi.fn(),
  startTurnMock: vi.fn(),
  transactionMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/helpers/cron", () => ({
  computeNextRunWithMinimumInterval: computeNextRunMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    sokoBotSchedule: {
      findFirst: dueScheduleFindFirstMock,
      update: scheduleUpdateMock,
      updateMany: scheduleUpdateManyMock,
    },
    sokoBotScheduleRun: {
      findFirst: runFindFirstMock,
      updateMany: runUpdateManyMock,
    },
    sokoBotTurn: { findUnique: turnFindUniqueMock },
  },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class SokoBotBusyError extends Error {},
  SokoBotRetryableStartError: class SokoBotRetryableStartError extends Error {},
  sokoBotControlPlane: {
    reconcileTurn: reconcileTurnMock,
    startTurn: startTurnMock,
  },
}));

import { conflict } from "@/helpers/error";
import { CONCURRENCY_CONFLICT_KIND } from "@/lib/db/transaction";
import { SokoBotRuntimeUnavailableError } from "@/lib/soko-bot/runtime-errors";
import {
  SokoBotBusyError,
  SokoBotRetryableStartError,
} from "@/services/soko-bot-control-plane.service";
import {
  MAX_CONSECUTIVE_SCHEDULE_FAILURES,
  SokoBotSchedulesSyncService,
  sokoBotScheduleClientTurnId,
} from "@/services/soko-bot-schedules-sync.service";

function continueFor(maxChecks: number) {
  let checks = 0;
  return () => checks++ < maxChecks;
}

const scheduledFor = new Date("2026-08-17T12:00:00.000Z");
const dueSchedule = {
  id: "01960001-0001-7001-8001-000000000001",
  userId: "user_1",
  workspaceId: "01960001-0001-7001-8001-000000000002",
  cronExpression: "0 * * * * *",
  timezone: "UTC",
  prompt: "Review active work",
  nextRunAt: scheduledFor,
  consecutiveFailures: 0,
};
const claimedRun = {
  id: "01960001-0001-7001-8001-000000000003",
  attempt: 1,
  prompt: dueSchedule.prompt,
  turnId: null,
  leaseToken: "lease_1",
  leaseExpiresAt: new Date("2026-08-17T12:05:00.000Z"),
};

function expiredClaimedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: claimedRun.id,
    attempt: 1,
    scheduledFor,
    prompt: dueSchedule.prompt,
    turnId: null,
    leaseToken: "expired-lease",
    leaseExpiresAt: new Date(0),
    status: "CLAIMED",
    scheduleId: dueSchedule.id,
    schedule: dueSchedule,
    ...overrides,
  };
}

describe("sokoBotScheduleClientTurnId", () => {
  it("is stable across retry attempts", () => {
    expect(sokoBotScheduleClientTurnId(dueSchedule.id, scheduledFor)).toBe(
      `schedule:${dueSchedule.id}:2026-08-17T12:00:00.000Z`,
    );
    expect(
      sokoBotScheduleClientTurnId(dueSchedule.id, scheduledFor),
    ).not.toContain("attempt");
  });
});

describe("SokoBotSchedulesSyncService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    runFindFirstMock.mockResolvedValue(null);
    dueScheduleFindFirstMock.mockResolvedValue(dueSchedule);
    computeNextRunMock.mockReturnValue(new Date("2026-08-17T13:00:00.000Z"));
    scheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleUpdateMock.mockResolvedValue({});
    runCreateMock.mockResolvedValue(claimedRun);
    runUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionMock.mockImplementation(
      async (operation: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
        Array.isArray(operation)
          ? Promise.all(operation)
          : operation({
              sokoBotSchedule: {
                update: scheduleUpdateMock,
                updateMany: scheduleUpdateManyMock,
              },
              sokoBotScheduleRun: {
                create: runCreateMock,
                updateMany: runUpdateManyMock,
              },
            }),
    );
    startTurnMock.mockResolvedValue({ turnId: "turn_1", status: "RUNNING" });
  });

  it("immediately enqueues a fresh turn for reconciliation", async () => {
    const enqueueReconciliation = vi.fn();
    startTurnMock.mockResolvedValue({
      turnId: "turn_1",
      status: "RUNNING",
      reconciliationLeaseToken: "turn-lease-1",
    });
    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
      enqueueReconciliation,
    });

    expect(result).toEqual({
      claimed: 1,
      completed: 0,
      failed: 0,
      deferred: 1,
    });
    expect(startTurnMock).toHaveBeenCalledWith({
      userId: dueSchedule.userId,
      workspaceId: dueSchedule.workspaceId,
      clientTurnId: sokoBotScheduleClientTurnId(dueSchedule.id, scheduledFor),
      message: dueSchedule.prompt,
      source: "SCHEDULE",
      scheduleReservation: {
        runId: claimedRun.id,
        attempt: claimedRun.attempt,
        leaseToken: expect.any(String),
      },
    });
    expect(enqueueReconciliation).toHaveBeenCalledWith({
      turnId: "turn_1",
      leaseToken: "turn-lease-1",
    });
    expect(runUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: claimedRun.id,
        status: "CLAIMED",
        attempt: claimedRun.attempt,
        leaseToken: expect.any(String),
        turnId: "turn_1",
      },
      data: { status: "RUNNING" },
    });
  });

  it("snapshots the occurrence prompt when claiming a due schedule", async () => {
    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(runCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ prompt: "Review active work" }),
    });
  });

  it("settles a run when startTurn returns an already-terminal duplicate", async () => {
    startTurnMock.mockResolvedValue({ turnId: "turn_1", status: "COMPLETED" });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(reconcileTurnMock).not.toHaveBeenCalled();
  });

  it("backs off a transient terminal duplicate instead of consuming it as a successful start", async () => {
    startTurnMock.mockResolvedValue({
      turnId: "turn_1",
      status: "FAILED",
      duplicate: true,
      errorKind: "runtime_start_ambiguous",
    });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ failed: 0, deferred: 1 });
    expect(runUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "CLAIMED",
          attempt: claimedRun.attempt,
        }),
        data: expect.objectContaining({
          status: "PENDING",
          errorKind: "runtime_transient",
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it("atomically resets failures when a reclaimed duplicate already completed", async () => {
    const expired = expiredClaimedRun({
      schedule: { ...dueSchedule, consecutiveFailures: 3 },
    });
    runFindFirstMock.mockResolvedValue(expired);
    dueScheduleFindFirstMock.mockResolvedValue(null);
    runUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    startTurnMock.mockResolvedValue({
      turnId: "turn_duplicate",
      status: "COMPLETED",
      duplicate: true,
    });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ completed: 1, failed: 0, deferred: 0 });
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: expired.id,
        status: "CLAIMED",
        attempt: 2,
        leaseToken: expect.any(String),
      },
      data: expect.objectContaining({
        status: "COMPLETED",
        turnId: "turn_duplicate",
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    });
    expect(scheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: dueSchedule.id },
      data: { consecutiveFailures: 0 },
    });
  });

  it("atomically disables after reclaimed duplicate terminal failure exhausts budget", async () => {
    const expired = expiredClaimedRun({
      schedule: {
        ...dueSchedule,
        consecutiveFailures: MAX_CONSECUTIVE_SCHEDULE_FAILURES - 1,
      },
    });
    runFindFirstMock.mockResolvedValue(expired);
    dueScheduleFindFirstMock.mockResolvedValue(null);
    runUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    startTurnMock.mockResolvedValue({
      turnId: "turn_duplicate",
      status: "FAILED",
      duplicate: true,
    });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ completed: 0, failed: 1, deferred: 0 });
    expect(scheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: dueSchedule.id },
      data: {
        consecutiveFailures: { increment: 1 },
        enabled: false,
      },
    });
  });

  it("does not account a reclaimed duplicate when terminal settlement CAS loses", async () => {
    runFindFirstMock.mockResolvedValue(expiredClaimedRun());
    dueScheduleFindFirstMock.mockResolvedValue(null);
    runUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    startTurnMock.mockResolvedValue({
      turnId: "turn_duplicate",
      status: "FAILED",
      duplicate: true,
    });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ completed: 0, failed: 0, deferred: 1 });
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
  });

  it("does not fail or account an occurrence after its lease was reclaimed", async () => {
    runFindFirstMock.mockResolvedValue(expiredClaimedRun());
    dueScheduleFindFirstMock.mockResolvedValue(null);
    runUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    startTurnMock.mockRejectedValue(new Error("old worker failed"));

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ failed: 0, deferred: 1 });
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: claimedRun.id,
        status: "CLAIMED",
        attempt: 2,
        leaseToken: expect.any(String),
      },
      data: expect.objectContaining({ status: "FAILED" }),
    });
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
  });

  it("advances an overdue schedule from now instead of replaying missed ticks", async () => {
    const now = new Date("2026-08-18T15:30:00.000Z");
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now.getTime());

    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(computeNextRunMock).toHaveBeenCalledWith(
      {
        cron: dueSchedule.cronExpression,
        timezone: dueSchedule.timezone,
        from: now,
      },
      60_000,
    );
    dateNow.mockRestore();
  });

  it("reclaims an expired CLAIMED occurrence under compare-and-set", async () => {
    const expired = expiredClaimedRun();
    runFindFirstMock.mockResolvedValue(expired);
    dueScheduleFindFirstMock.mockResolvedValue(null);

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result.claimed).toBe(1);
    expect(runUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: expired.id,
        status: "CLAIMED",
        attempt: 1,
        leaseToken: "expired-lease",
        leaseExpiresAt: expired.leaseExpiresAt,
      },
      data: {
        status: "CLAIMED",
        attempt: { increment: 1 },
        prompt: dueSchedule.prompt,
        leaseToken: expect.any(String),
        leaseExpiresAt: expect.any(Date),
      },
    });
    expect(startTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId: sokoBotScheduleClientTurnId(dueSchedule.id, scheduledFor),
      }),
    );
  });

  it("does not reclaim when another worker wins the compare-and-set", async () => {
    runFindFirstMock.mockResolvedValue(expiredClaimedRun());
    runUpdateManyMock.mockResolvedValue({ count: 0 });
    dueScheduleFindFirstMock.mockResolvedValue(null);

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(2),
    });

    expect(result.claimed).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
  });

  it("recovers a disabled occurrence with its prompt after the schedule was edited", async () => {
    const occurrence = expiredClaimedRun({
      prompt: "Original occurrence prompt",
      schedule: {
        ...dueSchedule,
        enabled: false,
        prompt: "Edited future prompt",
      },
    });
    runFindFirstMock.mockImplementation(async ({ where }) =>
      where.schedule.enabled === true ? null : occurrence,
    );
    dueScheduleFindFirstMock.mockResolvedValue(null);

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result.claimed).toBe(1);
    expect(startTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Original occurrence prompt" }),
    );
  });

  it("binds the same clientTurnId when retrying after a crash before turnId link", async () => {
    runFindFirstMock.mockResolvedValue(expiredClaimedRun({ turnId: null }));
    dueScheduleFindFirstMock.mockResolvedValue(null);
    startTurnMock.mockResolvedValue({
      turnId: "turn_dup",
      status: "RUNNING",
      duplicate: true,
    });

    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(startTurnMock).toHaveBeenCalledTimes(1);
    expect(startTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId: sokoBotScheduleClientTurnId(dueSchedule.id, scheduledFor),
      }),
    );
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: claimedRun.id,
        status: "CLAIMED",
        attempt: 2,
        leaseToken: expect.any(String),
        turnId: "turn_dup",
      },
      data: { status: "RUNNING" },
    });
  });

  it("reuses a linked turn instead of starting again after reclaim", async () => {
    runFindFirstMock.mockResolvedValue(
      expiredClaimedRun({ turnId: "turn_existing" }),
    );
    dueScheduleFindFirstMock.mockResolvedValue(null);
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_existing",
      status: "RUNNING",
    });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result.deferred).toBe(1);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: claimedRun.id,
        status: "CLAIMED",
        attempt: 2,
        leaseToken: expect.any(String),
        turnId: "turn_existing",
      },
      data: { status: "RUNNING" },
    });
  });

  it("starts claimed occurrences concurrently", async () => {
    const secondRun = expiredClaimedRun({
      id: "01960001-0001-7001-8001-000000000004",
      scheduledFor: new Date("2026-08-17T13:00:00.000Z"),
    });
    runFindFirstMock
      .mockResolvedValueOnce(expiredClaimedRun())
      .mockResolvedValueOnce(secondRun)
      .mockResolvedValue(null);
    dueScheduleFindFirstMock.mockResolvedValue(null);

    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    startTurnMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight -= 1;
      return { turnId: `turn_${inFlight}`, status: "RUNNING" };
    });

    const pending = new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(3),
    });
    await vi.waitFor(() => expect(startTurnMock).toHaveBeenCalledTimes(2));
    expect(maxInFlight).toBe(2);
    release();
    const result = await pending;

    expect(result.claimed).toBe(2);
    expect(result.deferred).toBe(2);
    expect(reconcileTurnMock).not.toHaveBeenCalled();
  });

  it("dead-letters a busy occurrence after its bounded retry budget", async () => {
    runFindFirstMock.mockResolvedValue(expiredClaimedRun({ attempt: 4 }));
    dueScheduleFindFirstMock.mockResolvedValue(null);
    startTurnMock.mockRejectedValue(new SokoBotBusyError("Bot busy"));

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toEqual({
      claimed: 1,
      completed: 0,
      failed: 1,
      deferred: 0,
    });
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: claimedRun.id,
          status: "CLAIMED",
          attempt: 5,
          leaseToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: "DEAD_LETTER",
          errorKind: "bot_busy",
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(scheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: dueSchedule.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
  });

  it("backs off a transient Eve failure without counting schedule failure", async () => {
    startTurnMock.mockRejectedValue(
      new SokoBotRuntimeUnavailableError("Soko Bot runtime is unavailable"),
    );

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ failed: 0, deferred: 1 });
    expect(runUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          errorKind: "runtime_transient",
          leaseToken: null,
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
  });

  it("backs off a scheduled classifier failure for retry", async () => {
    startTurnMock.mockRejectedValue(
      new SokoBotRetryableStartError("Classifier unavailable"),
    );

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ failed: 0, deferred: 1 });
    expect(runUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          errorKind: "runtime_transient",
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
  });

  it("backs off a serializable concurrency conflict without accounting failure", async () => {
    startTurnMock.mockRejectedValue(
      conflict("Soko Bot turn collided", {
        kind: CONCURRENCY_CONFLICT_KIND,
      }),
    );

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ failed: 0, deferred: 1 });
    expect(runUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          errorKind: "runtime_transient",
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
  });

  it("dead-letters a transient Eve failure after bounded attempts", async () => {
    runFindFirstMock.mockResolvedValue(expiredClaimedRun({ attempt: 4 }));
    dueScheduleFindFirstMock.mockResolvedValue(null);
    startTurnMock.mockRejectedValue(
      new SokoBotRuntimeUnavailableError("Soko Bot runtime is unavailable"),
    );

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result).toMatchObject({ failed: 1, deferred: 0 });
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DEAD_LETTER",
          errorKind: "runtime_transient",
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
  });

  it("increments consecutive failures without disabling below the budget", async () => {
    runFindFirstMock.mockResolvedValue(
      expiredClaimedRun({
        schedule: { ...dueSchedule, consecutiveFailures: 3 },
      }),
    );
    dueScheduleFindFirstMock.mockResolvedValue(null);
    startTurnMock.mockRejectedValue(new Error("runtime start failed"));

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result.failed).toBe(1);
    expect(scheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: dueSchedule.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
  });

  it("redacts sensitive failure detail before persisting it", async () => {
    const secret = "redis://:hunter2@cache.example.com:6379/0";
    startTurnMock.mockRejectedValue(
      new Error(`Runtime could not connect to ${secret}`),
    );

    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(runUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorDetail: "[Sensitive value removed]",
        }),
      }),
    );
    expect(JSON.stringify(runUpdateManyMock.mock.calls)).not.toContain(secret);
  });

  it("caps failure detail by UTF-8 bytes", async () => {
    startTurnMock.mockRejectedValue(new Error("🧯".repeat(1_000)));

    await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    const errorDetail = runUpdateManyMock.mock.calls[0]?.[0]?.data?.errorDetail;
    expect(typeof errorDetail).toBe("string");
    expect(Buffer.byteLength(errorDetail, "utf8")).toBeLessThanOrEqual(1_000);
    expect(errorDetail).not.toContain("�");
  });

  it("disables the schedule after MAX_CONSECUTIVE_SCHEDULE_FAILURES start failures", async () => {
    expect(MAX_CONSECUTIVE_SCHEDULE_FAILURES).toBe(5);
    runFindFirstMock.mockResolvedValue(
      expiredClaimedRun({
        schedule: {
          ...dueSchedule,
          consecutiveFailures: MAX_CONSECUTIVE_SCHEDULE_FAILURES - 1,
        },
      }),
    );
    dueScheduleFindFirstMock.mockResolvedValue(null);
    startTurnMock.mockRejectedValue(new Error("runtime start failed"));

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(1),
    });

    expect(result.failed).toBe(1);
    expect(runUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorKind: "schedule_failed",
          errorDetail: "runtime start failed",
        }),
      }),
    );
    expect(scheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: dueSchedule.id },
      data: {
        consecutiveFailures: { increment: 1 },
        enabled: false,
      },
    });
  });

  it("disables a due schedule already at the failure budget instead of claiming a new run", async () => {
    runFindFirstMock.mockResolvedValue(null);
    dueScheduleFindFirstMock.mockResolvedValue({
      ...dueSchedule,
      consecutiveFailures: MAX_CONSECUTIVE_SCHEDULE_FAILURES,
    });

    const result = await new SokoBotSchedulesSyncService().syncDueSchedules({
      shouldContinue: continueFor(2),
    });

    expect(result.claimed).toBe(0);
    expect(startTurnMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: dueSchedule.id, enabled: true },
      data: { enabled: false },
    });
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
  });
});
