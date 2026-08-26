import { randomUUID } from "node:crypto";
import { redactSokoBotSensitiveText } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { getEnv } from "@/config/env";
import { computeNextRunWithMinimumInterval } from "@/helpers/cron";
import prisma from "@/lib/db/prisma";
import { CONCURRENCY_CONFLICT_KIND } from "@/lib/db/transaction";
import { EveRuntimeError } from "@/lib/soko-bot/eve-http-runtime";
import {
  SokoBotBusyError,
  SokoBotRetryableStartError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import {
  buildSystemBeatMessage,
  stampNudges,
} from "@/services/soko-bot-proactive.service";

const SCHEDULE_LEASE_MS = 5 * 60 * 1_000;
const BUSY_RETRY_DELAY_MS = 60_000;
const MAX_BUSY_ATTEMPTS = 5;
const MAX_TRANSIENT_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;
export const MAX_CONSECUTIVE_SCHEDULE_FAILURES = 5;
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const BATCH_SIZE = 20;
const MAX_SCHEDULE_ERROR_DETAIL_BYTES = 1_000;

export interface SokoBotScheduleSyncInput {
  shouldContinue: () => boolean;
  enqueueReconciliation?: (input: {
    turnId: string;
    leaseToken?: string;
  }) => void;
}

export interface SokoBotScheduleSyncResult {
  claimed: number;
  completed: number;
  failed: number;
  deferred: number;
}

interface ClaimedOccurrence {
  run: {
    id: string;
    attempt: number;
    scheduledFor: Date;
    prompt: string | null;
    turnId: string | null;
    leaseToken: string;
    leaseExpiresAt: Date | null;
    status: string;
  };
  schedule: {
    id: string;
    sokoBotId: string;
    userId: string;
    workspaceId: string;
    cronExpression: string;
    timezone: string;
    prompt: string;
    systemKey: string | null;
    consecutiveFailures: number;
  };
  scheduledFor: Date;
}

function prismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function isRetryableScheduleFailure(error: unknown): boolean {
  if (
    error instanceof HTTPException &&
    error.status === 409 &&
    error.cause &&
    typeof error.cause === "object" &&
    "kind" in error.cause &&
    error.cause.kind === CONCURRENCY_CONFLICT_KIND
  ) {
    return true;
  }
  if (
    error instanceof SokoBotBusyError ||
    error instanceof SokoBotRetryableStartError ||
    error instanceof TypeError
  ) {
    return true;
  }
  if (error instanceof EveRuntimeError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return ["P1001", "P1002", "P2024", "P2034"].includes(
    prismaErrorCode(error) ?? "",
  );
}

function retryDelayMs(attempt: number): number {
  return Math.min(
    MAX_RETRY_DELAY_MS,
    BUSY_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const truncated = value.slice(0, low);
  return /[\uD800-\uDBFF]$/.test(truncated)
    ? truncated.slice(0, -1)
    : truncated;
}

function scheduleErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return truncateUtf8(
    redactSokoBotSensitiveText(message),
    MAX_SCHEDULE_ERROR_DETAIL_BYTES,
  );
}

export function sokoBotScheduleClientTurnId(
  scheduleId: string,
  scheduledFor: Date,
): string {
  return `schedule:${scheduleId}:${scheduledFor.toISOString()}`;
}

export class SokoBotSchedulesSyncService {
  private async claimRecoverableRun(): Promise<ClaimedOccurrence | null> {
    const now = new Date();
    const pending = await prisma.sokoBotScheduleRun.findFirst({
      where: {
        schedule: {
          sokoBot: { archivedAt: null, status: { not: "PAUSED" } },
        },
        OR: [
          {
            status: "PENDING",
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
          {
            status: "CLAIMED",
            leaseExpiresAt: { lte: now },
          },
        ],
      },
      include: { schedule: true },
      orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }],
    });
    if (!pending) return null;
    const leaseToken = randomUUID();
    const claimed = await prisma.sokoBotScheduleRun.updateMany({
      where: {
        id: pending.id,
        status: pending.status,
        attempt: pending.attempt,
        leaseToken: pending.leaseToken,
        leaseExpiresAt: pending.leaseExpiresAt,
      },
      data: {
        status: "CLAIMED",
        attempt: { increment: 1 },
        prompt: pending.prompt ?? pending.schedule.prompt,
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + SCHEDULE_LEASE_MS),
      },
    });
    if (claimed.count === 0) return null;
    const { schedule, ...run } = pending;
    return {
      run: {
        id: run.id,
        attempt: pending.attempt + 1,
        scheduledFor: run.scheduledFor,
        prompt: run.prompt ?? pending.schedule.prompt,
        turnId: run.turnId,
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + SCHEDULE_LEASE_MS),
        status: "CLAIMED",
      },
      schedule,
      scheduledFor: run.scheduledFor,
    };
  }

  private async claimDueOccurrence(): Promise<ClaimedOccurrence | null> {
    const due = await prisma.sokoBotSchedule.findFirst({
      where: {
        enabled: true,
        nextRunAt: { lte: new Date() },
        sokoBot: { archivedAt: null, status: { not: "PAUSED" } },
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    });
    if (!due?.nextRunAt) return null;
    if (await this.disableIfFailureBudgetExceeded(due)) {
      return null;
    }

    const scheduledFor = due.nextRunAt;
    const nextRunAt = computeNextRunWithMinimumInterval(
      {
        cron: due.cronExpression,
        timezone: due.timezone,
        from: new Date(Math.max(scheduledFor.getTime(), Date.now())),
      },
      MIN_SCHEDULE_INTERVAL_MS,
    );
    if (!nextRunAt) {
      await prisma.sokoBotSchedule.update({
        where: { id: due.id },
        data: {
          enabled: false,
          consecutiveFailures: { increment: 1 },
        },
      });
      return null;
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + SCHEDULE_LEASE_MS);
    const claimed = await prisma.$transaction(async (tx) => {
      const moved = await tx.sokoBotSchedule.updateMany({
        where: {
          id: due.id,
          enabled: true,
          nextRunAt: scheduledFor,
        },
        data: { nextRunAt, lastRunAt: scheduledFor },
      });
      if (moved.count === 0) return null;
      return tx.sokoBotScheduleRun.create({
        data: {
          scheduleId: due.id,
          scheduledFor,
          prompt: due.prompt,
          status: "CLAIMED",
          attempt: 1,
          leaseToken,
          leaseExpiresAt,
        },
      });
    });
    if (!claimed) return null;
    return {
      run: {
        id: claimed.id,
        attempt: claimed.attempt,
        scheduledFor,
        prompt: claimed.prompt,
        turnId: claimed.turnId,
        leaseToken,
        leaseExpiresAt,
        status: "CLAIMED",
      },
      schedule: due,
      scheduledFor,
    };
  }

  private async claimNextOccurrence(): Promise<ClaimedOccurrence | null> {
    return (await this.claimRecoverableRun()) ?? this.claimDueOccurrence();
  }

  private async disableIfFailureBudgetExceeded(schedule: {
    id: string;
    consecutiveFailures: number;
  }): Promise<boolean> {
    if (schedule.consecutiveFailures < MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
      return false;
    }
    await prisma.sokoBotSchedule.updateMany({
      where: { id: schedule.id, enabled: true },
      data: { enabled: false },
    });
    return true;
  }

  private scheduleFailureUpdate(consecutiveFailures: number): {
    consecutiveFailures: { increment: 1 };
    enabled?: false;
  } {
    return {
      consecutiveFailures: { increment: 1 },
      ...(consecutiveFailures + 1 >= MAX_CONSECUTIVE_SCHEDULE_FAILURES
        ? { enabled: false as const }
        : {}),
    };
  }

  private async settleTerminalOccurrence(
    claimed: ClaimedOccurrence,
    turnId: string,
    turnStatus: "COMPLETED" | "FAILED" | "CANCELLED",
  ): Promise<boolean> {
    const completed = turnStatus === "COMPLETED";
    return prisma.$transaction(async (tx) => {
      const settled = await tx.sokoBotScheduleRun.updateMany({
        where: {
          id: claimed.run.id,
          status: "CLAIMED",
          attempt: claimed.run.attempt,
          leaseToken: claimed.run.leaseToken,
        },
        data: {
          status: completed ? "COMPLETED" : "FAILED",
          turnId,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          errorKind: completed ? null : turnStatus.toLowerCase(),
        },
      });
      if (settled.count === 0) return false;
      await tx.sokoBotSchedule.update({
        where: { id: claimed.schedule.id },
        data: completed
          ? { consecutiveFailures: 0 }
          : this.scheduleFailureUpdate(claimed.schedule.consecutiveFailures),
      });
      return true;
    });
  }

  async syncDueSchedules(
    input: SokoBotScheduleSyncInput,
  ): Promise<SokoBotScheduleSyncResult> {
    const result: SokoBotScheduleSyncResult = {
      claimed: 0,
      completed: 0,
      failed: 0,
      deferred: 0,
    };
    if (!getEnv().SOKO_BOT_ENABLED) return result;

    const claimed: ClaimedOccurrence[] = [];
    while (input.shouldContinue() && claimed.length < BATCH_SIZE) {
      const next = await this.claimNextOccurrence();
      if (!next) break;
      claimed.push(next);
    }
    result.claimed = claimed.length;
    if (claimed.length === 0) return result;

    const outcomes = await Promise.allSettled(
      claimed.map((occurrence) =>
        this.startClaimedOccurrence(occurrence, input.enqueueReconciliation),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        result[outcome.value] += 1;
        continue;
      }
      result.failed += 1;
    }
    return result;
  }

  private async startClaimedOccurrence(
    claimed: ClaimedOccurrence,
    enqueueReconciliation?: SokoBotScheduleSyncInput["enqueueReconciliation"],
  ): Promise<"completed" | "failed" | "deferred"> {
    const { run, schedule, scheduledFor } = claimed;
    try {
      let turnId = run.turnId;
      let turnStatus: string | null = null;
      let turnErrorKind: string | null = null;
      let reconciliationLeaseToken: string | undefined;
      let startedFresh = false;
      if (turnId) {
        const existing = await prisma.sokoBotTurn.findUnique({
          where: { id: turnId },
          select: { id: true, status: true, errorKind: true },
        });
        if (existing) {
          turnStatus = existing.status;
          turnErrorKind = existing.errorKind;
        } else {
          turnId = null;
        }
      }
      if (!turnId) {
        let message = run.prompt ?? schedule.prompt;
        let nudgeKeys: string[] = [];
        if (schedule.systemKey) {
          const bot = await prisma.sokoBot.findUnique({
            where: { id: schedule.sokoBotId },
            select: {
              id: true,
              workspaceId: true,
              ingestTimezone: true,
              followWholeBoard: true,
              coworker: { select: { id: true } },
            },
          });
          if (bot) {
            const beat = await buildSystemBeatMessage({
              bot: {
                id: bot.id,
                coworkerId: bot.coworker?.id ?? null,
                workspaceId: bot.workspaceId,
                ingestTimezone: bot.ingestTimezone,
                followWholeBoard: bot.followWholeBoard,
              },
              key: schedule.systemKey,
              prompt: schedule.prompt,
              now: new Date(),
            });
            message = beat.message;
            nudgeKeys = beat.nudgeKeys;
          }
        }
        const started = await sokoBotControlPlane.startTurn({
          userId: schedule.userId,
          workspaceId: schedule.workspaceId,
          clientTurnId: sokoBotScheduleClientTurnId(schedule.id, scheduledFor),
          message,
          source: "SCHEDULE",
          scheduleReservation: {
            runId: run.id,
            attempt: run.attempt,
            leaseToken: run.leaseToken,
          },
        });
        turnId = started.turnId;
        turnStatus = started.status;
        turnErrorKind = started.errorKind ?? null;
        reconciliationLeaseToken = started.reconciliationLeaseToken;
        startedFresh = true;
        if (nudgeKeys.length > 0) {
          await stampNudges(schedule.sokoBotId, nudgeKeys, new Date());
        }
      }

      if (
        turnStatus === "FAILED" &&
        turnErrorKind === "runtime_start_ambiguous"
      ) {
        throw new EveRuntimeError(
          "Eve turn acceptance remains ambiguous",
          503,
          "runtime_start_ambiguous",
        );
      }

      if (
        turnStatus === "COMPLETED" ||
        turnStatus === "FAILED" ||
        turnStatus === "CANCELLED"
      ) {
        const completed = turnStatus === "COMPLETED";
        const settled = await this.settleTerminalOccurrence(
          claimed,
          turnId,
          turnStatus,
        );
        if (!settled) return "deferred";
        return completed ? "completed" : "failed";
      }

      const linked = await prisma.sokoBotScheduleRun.updateMany({
        where: {
          id: run.id,
          status: "CLAIMED",
          attempt: run.attempt,
          leaseToken: run.leaseToken,
          turnId,
        },
        data: { status: "RUNNING" },
      });
      if (linked.count === 0) return "deferred";
      if (startedFresh && turnId) {
        try {
          enqueueReconciliation?.({
            turnId,
            leaseToken: reconciliationLeaseToken,
          });
        } catch (error) {
          console.warn("Failed to enqueue scheduled turn reconciliation", {
            turnId,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }
      return "deferred";
    } catch (error) {
      const transient = isRetryableScheduleFailure(error);
      const maxAttempts =
        error instanceof SokoBotBusyError
          ? MAX_BUSY_ATTEMPTS
          : MAX_TRANSIENT_ATTEMPTS;
      const retrying = transient && claimed.run.attempt < maxAttempts;
      const settled = await prisma.$transaction(async (tx) => {
        const updated = await tx.sokoBotScheduleRun.updateMany({
          where: {
            id: claimed.run.id,
            status: "CLAIMED",
            attempt: claimed.run.attempt,
            leaseToken: claimed.run.leaseToken,
          },
          data: {
            status: retrying ? "PENDING" : transient ? "DEAD_LETTER" : "FAILED",
            completedAt: retrying ? null : new Date(),
            leaseToken: null,
            leaseExpiresAt: retrying
              ? new Date(Date.now() + retryDelayMs(claimed.run.attempt))
              : null,
            errorKind:
              error instanceof SokoBotBusyError
                ? "bot_busy"
                : transient
                  ? "runtime_transient"
                  : "schedule_failed",
            errorDetail: scheduleErrorDetail(error),
          },
        });
        if (updated.count === 0) return false;
        if (!retrying) {
          await tx.sokoBotSchedule.update({
            where: { id: claimed.schedule.id },
            data: this.scheduleFailureUpdate(
              claimed.schedule.consecutiveFailures,
            ),
          });
        }
        return true;
      });
      if (!settled) return "deferred";
      return retrying ? "deferred" : "failed";
    }
  }
}

export const sokoBotSchedulesSyncService = new SokoBotSchedulesSyncService();
