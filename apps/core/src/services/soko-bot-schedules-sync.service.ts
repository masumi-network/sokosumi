import { randomUUID } from "node:crypto";
import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  parseOwnerAuthority,
  redactSokoBotSensitiveText,
} from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { getEnv } from "@/config/env";
import { computeNextRunWithMinimumInterval } from "@/helpers/cron";
import prisma from "@/lib/db/prisma";
import { CONCURRENCY_CONFLICT_KIND } from "@/lib/db/transaction";
import { createCoreLogger, emitCoreError, logCoreWarning } from "@/lib/evlog";
import { sokoBotScheduleActingUserId } from "@/lib/soko-bot/acting-user";
import { DetachedNetworkRefusal } from "@/lib/soko-bot/detached-network";
import { isScheduleAuthorityRevoked } from "@/lib/soko-bot/owner-authority";
import {
  isRetryableSokoBotRuntimeError,
  SokoBotRuntimeUnavailableError,
} from "@/lib/soko-bot/runtime-errors";
import {
  finishStaleSchedule,
  isTemporaryScheduleRefusal,
  requireScheduledTurnProvenance,
  type ScheduledTurnProvenance,
  scheduleTurnProvenance,
} from "@/lib/soko-bot/schedule-resume";
import { nextEffectiveRun } from "@/lib/soko-bot/schedule-run-changes";
import {
  scheduleAuthorityRoute,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";
import {
  SokoBotBusyError,
  SokoBotNoDestinationError,
  SokoBotRetryableStartError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import {
  proactiveGate,
  stageSokoBotNudges,
} from "@/services/soko-bot-proactive.service";
import {
  disableScheduleIfCountLimitMet,
  isPlatformTurnFailure,
  MAX_CONSECUTIVE_SCHEDULE_FAILURES,
  recordCompletedScheduleRun,
} from "@/services/soko-bot-schedule.service";
import { buildScheduledSystemBeat } from "@/services/soko-bot-scheduled-beat.service";

const SCHEDULE_LEASE_MS = 5 * 60 * 1_000;
const BUSY_RETRY_DELAY_MS = 60_000;
const MAX_BUSY_ATTEMPTS = 5;
const MAX_TRANSIENT_ATTEMPTS = 5;
const MAX_NO_DESTINATION_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;
const MIN_SCHEDULE_INTERVAL_MS = 60_000;
const BATCH_SIZE = 20;
const MAX_SCHEDULE_ERROR_DETAIL_BYTES = 1_000;

export interface SokoBotScheduleSyncInput {
  shouldContinue: () => boolean;
  /**
   * Claim only this schedule's due or recoverable runs. The owner benchmark
   * fires its own schedule this way without touching anyone else's work.
   */
  scheduleId?: string;
  enqueueReconciliation?: (input: {
    turnId: string;
    leaseToken: string;
  }) => void;
}

export interface SokoBotScheduleSyncResult {
  claimed: number;
  /** The schedule runs this sync claimed. */
  runIds: string[];
  completed: number;
  failed: number;
  deferred: number;
}

interface ScheduleFailures {
  id: string;
  sokoBotId: string;
  systemKey: string | null;
  consecutiveFailures: number;
}

function disablesSchedule(consecutiveFailures: number): boolean {
  return consecutiveFailures + 1 >= MAX_CONSECUTIVE_SCHEDULE_FAILURES;
}

/** After a counted failure: alerts when that failure switched it off. */
function reportIfDisabled(schedule: ScheduleFailures): void {
  if (disablesSchedule(schedule.consecutiveFailures))
    reportScheduleDisabled(schedule);
}

/**
 * A schedule that switched itself off stays off until someone turns it back
 * on; a built-in rhythm is never re-created, so the bot loses it for good.
 */
function reportScheduleDisabled(schedule: ScheduleFailures): void {
  emitCoreError(
    {
      operation: "soko_bot_schedules_sync",
      sokoBot: { id: schedule.sokoBotId },
      schedule: { id: schedule.id, systemKey: schedule.systemKey },
    },
    {
      message: "A Soko Bot schedule switched itself off",
      why: `It failed ${MAX_CONSECUTIVE_SCHEDULE_FAILURES} runs in a row for reasons of its own (platform failures do not count)`,
      fix: "Read its runs' errorKind and errorDetail in soko_bot_schedule_run, fix the cause, then enable the schedule again (set consecutiveFailures to 0).",
    },
  );
}

interface ClaimedOccurrence {
  provenance: ScheduledTurnProvenance;
  run: {
    id: string;
    attempt: number;
    scheduledFor: Date;
    prompt: string | null;
    turnId: string | null;
    leaseToken: string;
    leaseExpiresAt: Date | null;
    status: "CLAIMED";
  };
  schedule: {
    id: string;
    jobId: string | null;
    network: string | null;
    preprodGeneration: number | null;
    sokoBotId: string;
    requestedByUserId: string | null;
    sokoBot: {
      userId: string | null;
      projectId?: string | null;
      versionId?: string | null;
    };
    workspaceId: string;
    cronExpression: string;
    timezone: string;
    prompt: string;
    systemKey: string | null;
    capabilityNames: string[];
    authority?: unknown;
    consecutiveFailures: number;
  };
  scheduledFor: Date;
}

type PickupResult = ClaimedOccurrence | "skipped" | null;

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
  if (isRetryableSokoBotRuntimeError(error)) {
    return true;
  }
  // P2028: no pool connection for a transaction in time, as under load.
  return ["P1001", "P1002", "P2024", "P2028", "P2034"].includes(
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

/**
 * What a run of a schedule the bot or owner wrote is asked: which schedule it
 * is, so the run can end a follow-up whose purpose is done, then the prompt.
 * Built-in rhythms keep their own prompt.
 */
export function scheduleRunPrompt(schedule: {
  id: string;
  name: string;
  prompt: string;
  systemKey: string | null;
  runOnce: boolean;
  cronExpression: string;
  timezone: string;
  taskId: string | null;
  jobId: string | null;
  authority?: unknown;
}): string {
  if (schedule.systemKey) return schedule.prompt;
  const watches = schedule.taskId
    ? ` It watches Task ${schedule.taskId}; Core removes it once that Task finishes.`
    : schedule.jobId
      ? ` It watches Job ${schedule.jobId}; Core removes it once that Job finishes.`
      : "";
  const keepsRunning = `It repeats (cron "${schedule.cronExpression}", ${schedule.timezone}) and keeps running: only the owner ends it. Never delete or switch it off; if it looks done or outdated, say so and let the owner decide.`;
  let lifecycle: string;
  if (schedule.runOnce) {
    lifecycle = "It runs once; Core removes it after this run.";
  } else {
    // Persisted OwnerAuthority is the single source of truth; legacy null or
    // malformed rows keep running until an owner explicitly binds a stop rule.
    const authority = parseOwnerAuthority(schedule.authority);
    const stopRule = authority?.stopRule;
    if (
      !stopRule ||
      stopRule.mode === "never" ||
      stopRule.mode === "owner_authorized_stop"
    ) {
      lifecycle = keepsRunning;
    } else if (stopRule.mode === "ends_on") {
      lifecycle = `It repeats (cron "${schedule.cronExpression}", ${schedule.timezone}). Its owner stop rule allows ending it on or after ${stopRule.endsOn}; once that time is reached, remove it with delete_schedule and scheduleId ${schedule.id}.`;
    } else if (stopRule.mode === "ends_after_runs") {
      const unit = stopRule.maxRuns === 1 ? "run" : "runs";
      lifecycle = `It repeats (cron "${schedule.cronExpression}", ${schedule.timezone}). Its owner stop rule ends it automatically after ${stopRule.maxRuns} successful ${unit}; do not delete or switch it off yourself.`;
    } else {
      const kind = stopRule.targetKind === "task" ? "Task" : "Job";
      lifecycle = `It repeats (cron "${schedule.cronExpression}", ${schedule.timezone}). Its owner stop rule allows ending it once ${kind} ${stopRule.targetId} is settled; only then remove it with delete_schedule and scheduleId ${schedule.id}.`;
    }
  }
  return `[Schedule "${schedule.name}" (scheduleId ${schedule.id}). ${lifecycle}${watches}]\n\n${schedule.prompt}`;
}

export class SokoBotSchedulesSyncService {
  private async claimRecoverableRun(
    scheduleId: string | undefined,
    skipped: Set<string>,
  ): Promise<PickupResult> {
    const now = new Date();
    const pending = await prisma.sokoBotScheduleRun.findFirst({
      where: {
        ...(scheduleId ? { scheduleId } : {}),
        schedule: {
          ...(skipped.size ? { id: { notIn: [...skipped] } } : {}),
          sokoBot: {
            archivedAt: null,
            status: { not: "PAUSED" },
          },
        },
        AND: [
          {
            // Keep one-time retries (`runOnce: true`) and reconciliation of
            // already-started turns (`turnId !== null`), while fencing
            // unstarted occurrences on disabled recurring schedules (e.g.
            // after `ends_after_runs` disables the schedule).
            OR: [
              { turnId: { not: null } },
              { schedule: { enabled: true } },
              { schedule: { runOnce: true } },
            ],
          },
          {
            OR: [
              {
                status: "PENDING",
                OR: [
                  { leaseExpiresAt: null },
                  { leaseExpiresAt: { lte: now } },
                ],
              },
              {
                status: "CLAIMED",
                leaseExpiresAt: { lte: now },
              },
            ],
          },
        ],
      },
      include: {
        schedule: {
          include: {
            sokoBot: {
              select: { userId: true, projectId: true, versionId: true },
            },
          },
        },
      },
      orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }],
    });
    if (!pending) return null;
    const { schedule, ...run } = pending;
    const provenance = await scheduleTurnProvenance(schedule).catch(
      (error: unknown) => {
        if (error instanceof DetachedNetworkRefusal) return error;
        throw error;
      },
    );
    if (provenance instanceof DetachedNetworkRefusal) {
      if (provenance.final) await finishStaleSchedule(schedule, run);
      skipped.add(schedule.id);
      return "skipped";
    }
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + SCHEDULE_LEASE_MS);
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
        leaseExpiresAt,
      },
    });
    if (claimed.count === 0) return null;
    return {
      provenance,
      run: {
        id: run.id,
        attempt: pending.attempt + 1,
        scheduledFor: run.scheduledFor,
        prompt: run.prompt ?? pending.schedule.prompt,
        turnId: run.turnId,
        leaseToken,
        leaseExpiresAt,
        status: "CLAIMED",
      },
      schedule,
      scheduledFor: run.scheduledFor,
    };
  }

  private async claimDueOccurrence(
    scheduleId: string | undefined,
    skipped: Set<string>,
  ): Promise<PickupResult> {
    // Platform kill switch: nothing the bot starts on its own may run.
    if (getEnv().SOKO_BOT_PROACTIVE_PAUSED) return null;
    const due = await prisma.sokoBotSchedule.findFirst({
      where: {
        ...(scheduleId ? { id: scheduleId } : {}),
        ...(skipped.size ? { NOT: { id: { in: [...skipped] } } } : {}),
        enabled: true,
        nextRunAt: { lte: new Date() },
        sokoBot: {
          archivedAt: null,
          status: { not: "PAUSED" },
          // Every schedule is something the bot runs unattended, including the
          // ones it created for itself through create_schedule, which needs no
          // approval. Gating only the built-in rhythms left the owner's pause
          // and the platform kill switch bypassable by the bot's own follow-ups.
          proactivePaused: false,
        },
      },
      include: {
        sokoBot: { select: { userId: true, projectId: true, versionId: true } },
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    });
    if (!due?.nextRunAt) return null;
    const provenance = await scheduleTurnProvenance(due).catch(
      (error: unknown) => {
        if (error instanceof DetachedNetworkRefusal) return error;
        throw error;
      },
    );
    if (provenance instanceof DetachedNetworkRefusal) {
      if (provenance.final) await finishStaleSchedule(due);
      skipped.add(due.id);
      return "skipped";
    }
    if (await this.disableIfFailureBudgetExceeded(due)) {
      return null;
    }
    const dueAuthority = parseOwnerAuthority(due.authority);
    if (
      dueAuthority?.stopRule.mode === "ends_after_runs" &&
      due.completedRuns >= dueAuthority.stopRule.maxRuns &&
      (await disableScheduleIfCountLimitMet(due.id, new Date()))
    ) {
      return null;
    }

    const scheduledFor = due.nextRunAt;
    const walkFrom = new Date(Math.max(scheduledFor.getTime(), Date.now()));
    const nextCronAt = due.runOnce
      ? scheduledFor
      : computeNextRunWithMinimumInterval(
          {
            cron: due.cronExpression,
            timezone: due.timezone,
            from: walkFrom,
          },
          MIN_SCHEDULE_INTERVAL_MS,
        );
    if (!nextCronAt) {
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
      let nextRunAt = nextCronAt;
      // Only schedules a member or the bot set up have runs moved or skipped.
      if (!due.runOnce && !due.systemKey && !due.taskId && !due.jobId) {
        // Same lock a Calendar run change takes before it writes, so the
        // walk below sees every run moved or skipped up to this claim.
        await tx.$queryRaw`
          SELECT "id" FROM ${sharedTable("soko_bot_schedule")}
          WHERE "id" = ${due.id}::uuid
          FOR UPDATE
        `;
        const changes = await tx.sokoBotScheduleRunChange.findMany({
          where: { scheduleId: due.id },
          select: { originalAt: true, scheduledAt: true },
        });
        // Cron runs a late claim missed coalesce into `nextCronAt`, but a
        // moved run after this one fires even when its time already passed:
        // moves walk from `scheduledFor`, cron times from `nextCronAt`.
        nextRunAt =
          nextEffectiveRun(due, changes, scheduledFor, nextCronAt) ??
          nextCronAt;
      }
      const moved = await tx.sokoBotSchedule.updateMany({
        where: {
          id: due.id,
          enabled: true,
          nextRunAt: scheduledFor,
        },
        // A one-time schedule is spent by its claim; a failed run retries
        // through its run row, not the schedule.
        data: due.runOnce
          ? { enabled: false, lastRunAt: scheduledFor }
          : { nextRunAt, lastRunAt: scheduledFor },
      });
      if (moved.count === 0) return null;
      return tx.sokoBotScheduleRun.create({
        data: {
          scheduleId: due.id,
          scheduledFor,
          prompt: scheduleRunPrompt(due),
          status: "CLAIMED",
          attempt: 1,
          leaseToken,
          leaseExpiresAt,
        },
      });
    });
    if (!claimed) return null;
    return {
      provenance,
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

  private async claimNextOccurrence(
    scheduleId: string | undefined,
    skipped: Set<string>,
  ): Promise<PickupResult> {
    return (
      (await this.claimRecoverableRun(scheduleId, skipped)) ??
      this.claimDueOccurrence(scheduleId, skipped)
    );
  }

  private async disableIfFailureBudgetExceeded(
    schedule: ScheduleFailures,
  ): Promise<boolean> {
    if (schedule.consecutiveFailures < MAX_CONSECUTIVE_SCHEDULE_FAILURES) {
      return false;
    }
    const disabled = await prisma.sokoBotSchedule.updateMany({
      where: { id: schedule.id, enabled: true },
      data: { enabled: false },
    });
    if (disabled.count > 0) reportScheduleDisabled(schedule);
    return true;
  }

  private scheduleFailureUpdate(consecutiveFailures: number): {
    consecutiveFailures: { increment: 1 };
    enabled?: false;
  } {
    return {
      consecutiveFailures: { increment: 1 },
      ...(disablesSchedule(consecutiveFailures)
        ? { enabled: false as const }
        : {}),
    };
  }

  private async settleTerminalOccurrence(
    claimed: ClaimedOccurrence,
    turnId: string | null,
    turnStatus: "COMPLETED" | "FAILED" | "CANCELLED",
    turnErrorKind: string | null = null,
  ): Promise<boolean> {
    const completed = turnStatus === "COMPLETED";
    const counts = !completed && !isPlatformTurnFailure(turnErrorKind);
    const settled = await prisma.$transaction(async (tx) => {
      const settled = await tx.sokoBotScheduleRun.updateMany({
        where: {
          id: claimed.run.id,
          status: "CLAIMED",
          attempt: claimed.run.attempt,
          leaseToken: claimed.run.leaseToken,
        },
        data: {
          status: completed ? "COMPLETED" : "FAILED",
          ...(turnId != null ? { turnId } : {}),
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          errorKind: completed ? null : turnStatus.toLowerCase(),
        },
      });
      if (settled.count === 0) return false;
      if (completed) {
        await recordCompletedScheduleRun(tx, claimed.schedule.id, new Date());
      } else if (counts) {
        await tx.sokoBotSchedule.update({
          where: { id: claimed.schedule.id },
          data: this.scheduleFailureUpdate(
            claimed.schedule.consecutiveFailures,
          ),
        });
      }
      return true;
    });
    if (settled && counts) reportIfDisabled(claimed.schedule);
    return settled;
  }

  async syncDueSchedules(
    input: SokoBotScheduleSyncInput,
  ): Promise<SokoBotScheduleSyncResult> {
    const result: SokoBotScheduleSyncResult = {
      claimed: 0,
      runIds: [],
      completed: 0,
      failed: 0,
      deferred: 0,
    };
    if (!getEnv().SOKO_BOT_ENABLED) return result;

    const claimed: ClaimedOccurrence[] = [];
    const skipped = new Set<string>();
    while (input.shouldContinue() && claimed.length < BATCH_SIZE) {
      const next = await this.claimNextOccurrence(input.scheduleId, skipped);
      if (!next) break;
      if (next !== "skipped") claimed.push(next);
    }
    result.claimed = claimed.length;
    result.runIds = claimed.map((occurrence) => occurrence.run.id);
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
    const { run, schedule, scheduledFor, provenance } = claimed;
    try {
      let turnId = run.turnId;
      let turnStatus: string | null = null;
      let turnErrorKind: string | null = null;
      let reconciliationLeaseToken: string | undefined;
      if (turnId) {
        const existing = await prisma.sokoBotTurn.findUnique({
          where: { id: turnId },
          select: {
            id: true,
            status: true,
            errorKind: true,
            network: true,
            preprodGeneration: true,
          },
        });
        if (existing) {
          requireScheduledTurnProvenance(provenance, existing);
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
              userId: true,
              projectId: true,
              name: true,
              versionId: true,
            },
          });
          if (bot) {
            const beat = await buildScheduledSystemBeat(
              bot,
              schedule.systemKey,
              scheduledFor,
              schedule.prompt,
            );
            // Nothing to brief on (no external meeting, no mail waiting):
            // the occurrence is done without a turn or a cent spent.
            if (beat.skip) {
              const settled = await this.settleTerminalOccurrence(
                claimed,
                null,
                "COMPLETED",
              );
              return settled ? "completed" : "deferred";
            }
            message = beat.message;
            nudgeKeys = beat.nudgeKeys;
            // The reservation binds on the run's prompt; keep them equal.
            await prisma.sokoBotScheduleRun.update({
              where: { id: run.id },
              data: { prompt: message },
            });
          }
        }
        // A schedule the bot wrote for itself is still a turn it starts, and
        // it may create ten of them at a one-minute cadence. The owner's daily
        // limit is the ceiling on all of it.
        const gate = await proactiveGate(schedule.sokoBotId);
        if (!gate.ok) {
          // Busy rather than a bare "deferred": that leaves the run CLAIMED
          // with its attempt already spent and no lease released, so it is
          // re-claimed every five minutes forever and, because claiming is
          // recoverable-first within one batch, starves due schedules across
          // the platform. The busy path releases the lease and backs off.
          throw new SokoBotBusyError(
            "Soko Bot has reached its owner's daily limit",
          );
        }
        const actingUserId = sokoBotScheduleActingUserId(schedule);
        const systemRoute = systemScheduleRoute(schedule.systemKey);
        const scheduleRevoked =
          !systemRoute && schedule.authority != null
            ? await isScheduleAuthorityRevoked(schedule)
            : false;
        const started = await sokoBotControlPlane.startTurn({
          ...provenance,
          userId: actingUserId,
          sokoBotId: schedule.sokoBotId,
          workspaceId: schedule.workspaceId,
          clientTurnId: sokoBotScheduleClientTurnId(schedule.id, scheduledFor),
          message,
          source: "SCHEDULE",
          ownScheduleId: schedule.systemKey ? undefined : schedule.id,
          // Built-in rhythms run on the route Core gives them; a schedule the
          // owner or the bot wrote runs with its stored tools intersected
          // against its persisted OwnerAuthority.
          presetRoute:
            systemRoute ??
            scheduleAuthorityRoute({
              id: schedule.id,
              sokoBotId: schedule.sokoBotId,
              workspaceId: schedule.workspaceId,
              capabilityNames: schedule.capabilityNames,
              authority: schedule.authority ?? null,
              actingUserId,
              botUserId: schedule.sokoBot.userId,
              botProjectId: schedule.sokoBot.projectId ?? null,
              botVersionId: schedule.sokoBot.versionId ?? null,
              ...(scheduleRevoked ? { revoked: true } : {}),
            }),
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
        if (nudgeKeys.length > 0) {
          await stageSokoBotNudges(
            schedule.sokoBotId,
            nudgeKeys,
            new Date(),
            started.turnId,
          );
        }
      }

      if (
        turnStatus === "FAILED" &&
        turnErrorKind === "runtime_start_ambiguous"
      ) {
        throw new SokoBotRuntimeUnavailableError(
          "Soko Bot turn acceptance remains ambiguous",
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
          turnErrorKind,
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
      if (reconciliationLeaseToken && turnId) {
        try {
          enqueueReconciliation?.({
            turnId,
            leaseToken: reconciliationLeaseToken,
          });
        } catch (error) {
          // The schedules cron runs after its response: its own event.
          const log = createCoreLogger({
            operation: "soko_bot_schedules_sync",
            turn: { id: turnId },
          });
          logCoreWarning(
            log,
            {
              message: "Could not start draining a scheduled Soko Bot turn",
              why: "Enqueueing the reconciliation threw",
              fix: "The turn has started; the soko-bot-turns sync drains it instead.",
            },
            // The raw error is redacted detail, never the why.
            { cause: error },
          );
          log.emit();
        }
      }
      return "deferred";
    } catch (error) {
      if (isTemporaryScheduleRefusal(schedule, error)) {
        await prisma.sokoBotScheduleRun.updateMany({
          where: {
            id: run.id,
            status: "CLAIMED",
            attempt: run.attempt,
            leaseToken: run.leaseToken,
          },
          data: {
            status: "PENDING",
            attempt: { decrement: 1 },
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        return "deferred";
      }
      if (error instanceof DetachedNetworkRefusal) {
        return (await finishStaleSchedule(schedule, run))
          ? "failed"
          : "deferred";
      }
      const noDestination = error instanceof SokoBotNoDestinationError;
      const transient = isRetryableScheduleFailure(error);
      const maxAttempts = noDestination
        ? MAX_NO_DESTINATION_ATTEMPTS
        : error instanceof SokoBotBusyError
          ? MAX_BUSY_ATTEMPTS
          : MAX_TRANSIENT_ATTEMPTS;
      const retrying =
        (transient || noDestination) && claimed.run.attempt < maxAttempts;
      const settled = await prisma.$transaction(async (tx) => {
        const updated = await tx.sokoBotScheduleRun.updateMany({
          where: {
            id: claimed.run.id,
            status: "CLAIMED",
            attempt: claimed.run.attempt,
            leaseToken: claimed.run.leaseToken,
          },
          data: {
            status: retrying
              ? "PENDING"
              : transient || noDestination
                ? "DEAD_LETTER"
                : "FAILED",
            completedAt: retrying ? null : new Date(),
            leaseToken: null,
            leaseExpiresAt: retrying
              ? new Date(Date.now() + retryDelayMs(claimed.run.attempt))
              : null,
            errorKind: noDestination
              ? "no_destination"
              : error instanceof SokoBotBusyError
                ? "bot_busy"
                : transient
                  ? "runtime_transient"
                  : "schedule_failed",
            errorDetail: scheduleErrorDetail(error),
          },
        });
        if (updated.count === 0) return false;
        // A missing room is configuration, and a transient failure (the
        // daily limit, a runtime or database hiccup) is the platform's: they
        // bound this occurrence but keep the schedule's later ones eligible.
        if (!transient && !noDestination) {
          await tx.sokoBotSchedule.update({
            where: { id: claimed.schedule.id },
            data: this.scheduleFailureUpdate(
              claimed.schedule.consecutiveFailures,
            ),
          });
        }
        return true;
      });
      if (settled && !transient && !noDestination)
        reportIfDisabled(claimed.schedule);
      if (!settled) return "deferred";
      return retrying ? "deferred" : "failed";
    }
  }
}

export const sokoBotSchedulesSyncService = new SokoBotSchedulesSyncService();
