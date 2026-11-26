import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { hasAssignedOrganizationSeat } from "@sokosumi/database/helpers";
import { sharedTable } from "@sokosumi/database/sql-tables";
import {
  evaluateScheduleStopRule,
  getSokoBotVersion,
  type OwnerAuthority,
  OwnerAuthorityError,
  parseOwnerAuthority,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { computeNextRunWithMinimumInterval } from "@/helpers/cron";
import { conflict } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { isSharedSokoBot } from "@/helpers/soko-bot-kind";
import { ME_SOKO_BOT, memberSokoBot } from "@/helpers/soko-bot-resolver";
import { sokoBotForTurnMember } from "@/helpers/soko-bot-turn-authority";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import { AI_BUDGET_EXCEEDED } from "@/lib/ai-gateway-budget";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { sokoBotScheduleActingUserId } from "@/lib/soko-bot/acting-user";
import {
  checkScheduleFirstRunCapabilities,
  intersectOwnerAuthority,
} from "@/lib/soko-bot/owner-authority";
import {
  effectiveRuns,
  isCronTime,
  nextEffectiveRun,
  type ScheduleRunChange,
} from "@/lib/soko-bot/schedule-run-changes";
import { RUN_HORIZON_MS } from "@/services/task-schedule-runs.service";

const MIN_SCHEDULE_INTERVAL_MS = 60_000;
/** The owner's own schedules; the bot's system rhythms do not count. */
export const MAX_ACTIVE_SOKO_BOT_SCHEDULES = 10;
/** Consecutive failed runs after which a schedule switches itself off. */
export const MAX_CONSECUTIVE_SCHEDULE_FAILURES = 5;

/**
 * Turn failures of the platform (runtime, sandbox, deploy, limit), not the
 * schedule's. The sandbox supervisor reports a runner that died as
 * `runner_exited` and a sandbox that never started as `sandbox_launch_failed`.
 */
const PLATFORM_TURN_FAILURES: ReadonlySet<string> = new Set([
  AI_BUDGET_EXCEEDED,
  "busy",
  "runner_exited",
  "runtime_start_ambiguous",
  "runtime_start_failed",
  "runtime_stream_interrupted",
  "runtime_unreachable",
  "sandbox_launch_failed",
  "start_aborted",
  "turn_deadline_exceeded",
]);

/**
 * Whether a failed turn says nothing about its schedule: the platform failed
 * it (a provider or gateway error is stored by its class name, `AI_…` or
 * `Gateway…`). Such failures do not count toward switching a schedule off,
 * so an outage cannot turn off every bot's rhythms.
 */
export function isPlatformTurnFailure(errorKind: string | null): boolean {
  if (!errorKind) return false;
  return (
    PLATFORM_TURN_FAILURES.has(errorKind) ||
    errorKind.startsWith("AI_") ||
    errorKind.startsWith("Gateway")
  );
}

export class SokoBotScheduleNotFoundError extends Error {}
export class SokoBotScheduleValidationError extends Error {}

export interface ScheduleAuthorityResolveContext {
  scheduleId: string;
  sokoBotId: string;
  workspaceId: string;
  existingAuthority: OwnerAuthority | null;
  botProjectId: string | null;
  botVersionId: string | null;
  sharedBot: boolean;
}

export type ResolveScheduleAuthority = (
  context: ScheduleAuthorityResolveContext,
) => OwnerAuthority | undefined;

function resolveScheduleAuthorityField(
  resolve: ResolveScheduleAuthority,
  context: ScheduleAuthorityResolveContext,
): OwnerAuthority | undefined {
  try {
    return resolve(context);
  } catch (error) {
    if (error instanceof OwnerAuthorityError) {
      throw new SokoBotScheduleValidationError(error.message);
    }
    throw error;
  }
}

export interface CreateSokoBotScheduleInput {
  /** The member who asked; null when a shared bot acts on its own. */
  userId: string | null;
  workspaceId: string;
  /** The bot a turn runs as; without it, the caller's personal bot. */
  sokoBotId?: string;
  name: string;
  timezone: string;
  /** Recurring runs; exactly one of `cronExpression` and `runAt`. */
  cronExpression?: string;
  /** One run at this instant (ISO 8601), then the schedule disables itself. */
  runAt?: string;
  prompt: string;
  /** The writing turn's tools, when the bot wrote it; see the schema. */
  capabilityNames?: readonly string[];
  /** Work the schedule watches; it is removed once that work finishes. */
  taskId?: string;
  jobId?: string;
  /** Resolves the persisted OwnerAuthority bound to this schedule row. */
  resolveAuthority?: ResolveScheduleAuthority;
}

const MAX_ONE_TIME_LEAD_MS = 366 * 24 * 60 * 60 * 1_000;

function isRestricted(field: string | undefined): boolean {
  return field !== undefined && field !== "*" && field !== "?";
}

/**
 * Cron runs when day-of-month OR weekday matches once both are set, so
 * "0 10 1-7 * 1" fires every Monday and on the 1st–7th. Nobody means that.
 */
function assertNoDayOrTrap(cronExpression: string) {
  const fields = cronExpression.trim().split(/\s+/);
  const [dayOfMonth, , dayOfWeek] = fields.slice(-3);
  if (isRestricted(dayOfMonth) && isRestricted(dayOfWeek)) {
    throw new SokoBotScheduleValidationError(
      "Cron treats a day-of-month together with a weekday as either one, not both. For an nth weekday use `#` in the weekday field (first Monday: `0 10 * * 1#1`) and `*` for day-of-month.",
    );
  }
}

/** Minute, hour, day and month of `at` on the wall clock of `timezone`. */
function wallClockCron(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${Number(parts.minute)} ${Number(parts.hour)} ${Number(parts.day)} ${Number(parts.month)} *`;
}

export function resolveScheduleTiming(
  input: { cronExpression?: string; runAt?: string; timezone: string },
  now = new Date(),
): { cronExpression: string; nextRunAt: Date; runOnce: boolean } {
  if (input.runAt) {
    const at = new Date(input.runAt);
    if (
      Number.isNaN(at.getTime()) ||
      at.getTime() <= now.getTime() ||
      at.getTime() - now.getTime() > MAX_ONE_TIME_LEAD_MS
    ) {
      throw new SokoBotScheduleValidationError(
        "runAt must be a moment in the future, within a year",
      );
    }
    let cronExpression: string;
    try {
      cronExpression = wallClockCron(at, input.timezone);
    } catch {
      throw new SokoBotScheduleValidationError(
        `Unknown timezone ${input.timezone}`,
      );
    }
    return { cronExpression, nextRunAt: at, runOnce: true };
  }
  if (!input.cronExpression) {
    throw new SokoBotScheduleValidationError(
      "Give a cronExpression for a recurring schedule or runAt for a one-time one",
    );
  }
  assertNoDayOrTrap(input.cronExpression);
  const nextRunAt = computeNextRunWithMinimumInterval(
    { cron: input.cronExpression, timezone: input.timezone, from: now },
    MIN_SCHEDULE_INTERVAL_MS,
  );
  if (!nextRunAt) {
    throw new SokoBotScheduleValidationError(
      "Invalid cron expression, timezone, or interval below one minute",
    );
  }
  return { cronExpression: input.cronExpression, nextRunAt, runOnce: false };
}

export interface UpdateSokoBotScheduleInput {
  /** The member editing; null when a shared bot acts on its own. */
  userId: string | null;
  scheduleId?: string;
  scheduleName?: string;
  workspaceId?: string;
  sokoBotId?: string;
  name?: string;
  enabled?: boolean;
  timezone?: string;
  cronExpression?: string;
  prompt?: string;
  /** Replaces the run's tools, when a person rewrote the schedule. */
  capabilityNames?: readonly string[];
  /** Skip, move or restore one run, shown to the caller at `expectedAt`. */
  run?: ScheduleRunChangeInput;
  /**
   * The caller is a bot that may not change its own built-in rhythms: only
   * a person changes or pauses those.
   */
  keepBuiltInRhythms?: boolean;
  /** Resolves an updated OwnerAuthority for this schedule row when needed. */
  resolveAuthority?: ResolveScheduleAuthority;
}

/**
 * The bot a schedule call reaches: one the member may reach, or, for a shared
 * bot acting on its own (`userId` null), that bot itself.
 */
function scheduleBot(
  userId: string | null,
  workspaceId: string,
  sokoBotId: string | undefined,
  db: Prisma.TransactionClient | typeof prisma,
) {
  if (userId !== null)
    return memberSokoBot(
      userId,
      workspaceId,
      sokoBotId ? { kind: "id", sokoBotId } : ME_SOKO_BOT,
      db,
    );
  return sokoBotId
    ? sokoBotForTurnMember(
        { sokoBotId, actingUserId: null, workspaceId },
        "notArchived",
        db,
      )
    : Promise.resolve(null);
}

/**
 * A shared bot's runs act for nobody, so the pool pays with no Seat check
 * (ADR 0057). The member who sets a run up needs their Seat instead.
 */
async function requireSharedBotScheduleSeat(
  userId: string | null,
  sokoBotId: string,
  db: Prisma.TransactionClient | typeof prisma,
) {
  if (userId === null) return;
  const bot = await db.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { userId: true, workspace: { select: { organizationId: true } } },
  });
  if (!bot || !isSharedSokoBot(bot)) return;
  await requireAssignedOrganizationSeat(
    userId,
    bot.workspace.organizationId,
    db,
  );
}

/** A watched Task or Job must be work of this workspace. */
async function requireWatchedWork(
  input: Pick<CreateSokoBotScheduleInput, "taskId" | "jobId" | "workspaceId">,
  db: Prisma.TransactionClient | typeof prisma,
) {
  if (input.taskId) {
    const task = await db.task.findFirst({
      where: { id: input.taskId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!task)
      throw new SokoBotScheduleValidationError(
        "The Task to watch is not in this workspace",
      );
  }
  if (input.jobId) {
    const job = await db.job.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!job)
      throw new SokoBotScheduleValidationError(
        "The Job to watch is not in this workspace",
      );
  }
}

/**
 * Recurring prompts a Soko Bot runs on cron. Shared by the owner's console
 * and the bot's own `*_schedule` tools, so a bot can set up its own
 * check-ins without an approval round-trip.
 */
export async function createSokoBotSchedule(
  input: CreateSokoBotScheduleInput,
  transaction?: Prisma.TransactionClient,
) {
  const db = transaction ?? prisma;
  const { cronExpression, nextRunAt, runOnce } = resolveScheduleTiming(input);
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (!name || !prompt) {
    throw new SokoBotScheduleValidationError(
      "Schedule name and prompt are required",
    );
  }
  const bot = await scheduleBot(
    input.userId,
    input.workspaceId,
    input.sokoBotId,
    db,
  );
  if (!bot) throw new SokoBotScheduleNotFoundError("Soko Bot not found");
  await requireSharedBotScheduleSeat(input.userId, bot.id, db);
  const memberId = input.userId;
  // The resolver already placed a bot acting on its own in its workspace.
  const workspace =
    memberId === null
      ? { id: input.workspaceId }
      : await db.workspace.findFirst({
          where: {
            id: input.workspaceId,
            OR: [
              { userId: memberId },
              { organization: { members: { some: { userId: memberId } } } },
            ],
          },
          select: { id: true },
        });
  if (!workspace) throw new SokoBotScheduleNotFoundError("Workspace not found");
  await requireWatchedWork(input, db);
  const botDetails =
    input.resolveAuthority || (input.capabilityNames?.length ?? 0) > 0
      ? await db.sokoBot.findUnique({
          where: { id: bot.id },
          select: { userId: true, projectId: true, versionId: true },
        })
      : null;
  const link = { taskId: input.taskId ?? null, jobId: input.jobId ?? null };
  const mutate = async (tx: Prisma.TransactionClient) => {
    // Same name = same follow-up: a model retrying or re-planning updates
    // the existing schedule instead of stacking duplicates.
    const existing = await tx.sokoBotSchedule.findFirst({
      where: { sokoBotId: bot.id, name: name.slice(0, 120) },
      select: {
        id: true,
        requestedByUserId: true,
        systemKey: true,
        authority: true,
        completedRuns: true,
        sokoBot: { select: SCHEDULE_STOP_AUTHORITY_BOT_SELECT },
      },
    });
    if (existing) {
      const now = new Date();
      const nextAuthority = input.resolveAuthority
        ? resolveScheduleAuthorityField(input.resolveAuthority, {
            scheduleId: existing.id,
            sokoBotId: bot.id,
            workspaceId: input.workspaceId,
            existingAuthority: parseOwnerAuthority(
              "authority" in existing ? existing.authority : null,
            ),
            botProjectId: botDetails?.projectId ?? null,
            botVersionId: botDetails?.versionId ?? null,
            sharedBot: botDetails ? isSharedSokoBot(botDetails) : false,
          })
        : undefined;
      const effectiveAuthority =
        nextAuthority ??
        parseOwnerAuthority(
          "authority" in existing ? existing.authority : null,
        );
      if (
        effectiveAuthority !== null &&
        existing.systemKey === null &&
        (input.capabilityNames?.length ?? 0) > 0
      ) {
        const botUserId =
          botDetails?.userId ?? existing.sokoBot?.userId ?? null;
        const capabilityCheck = checkScheduleFirstRunCapabilities({
          scheduleId: existing.id,
          sokoBotId: bot.id,
          workspaceId: input.workspaceId,
          authority: effectiveAuthority,
          actingUserId: sokoBotScheduleActingUserId({
            requestedByUserId: existing.requestedByUserId ?? null,
            systemKey: existing.systemKey,
            sokoBot: { userId: botUserId },
          }),
          botUserId,
          botProjectId:
            botDetails?.projectId ?? existing.sokoBot?.projectId ?? null,
          botVersionId:
            botDetails?.versionId ?? existing.sokoBot?.versionId ?? null,
          requestedCapabilities: input.capabilityNames ?? [],
          now,
        });
        if (!capabilityCheck.ok) {
          throw new SokoBotScheduleValidationError(capabilityCheck.detail);
        }
      }
      const completedRuns =
        "completedRuns" in existing &&
        typeof existing.completedRuns === "number"
          ? existing.completedRuns
          : 0;
      let countLimitAlreadyMet = false;
      if (
        effectiveAuthority?.stopRule.mode === "ends_after_runs" &&
        completedRuns >= effectiveAuthority.stopRule.maxRuns
      ) {
        const existingBot =
          "sokoBot" in existing && existing.sokoBot
            ? existing.sokoBot
            : await tx.sokoBot.findUnique({
                where: { id: bot.id },
                select: SCHEDULE_STOP_AUTHORITY_BOT_SELECT,
              });
        countLimitAlreadyMet = await isCountStopRuleAuthorizedAndMet(
          tx,
          {
            id: existing.id,
            sokoBotId: bot.id,
            workspaceId: input.workspaceId,
            completedRuns,
            authority: effectiveAuthority,
            sokoBot: existingBot,
          },
          now,
        );
      }
      // The Requester stays whoever asked first (ADR 0057).
      const updated = await tx.sokoBotSchedule.update({
        where: { id: existing.id },
        data: {
          enabled: !countLimitAlreadyMet,
          consecutiveFailures: 0,
          workspaceId: input.workspaceId,
          timezone: input.timezone,
          cronExpression,
          runOnce,
          prompt: prompt.slice(0, 20_000),
          nextRunAt,
          capabilityNames: [...(input.capabilityNames ?? [])],
          ...link,
          ...(nextAuthority !== undefined
            ? { authority: nextAuthority as Prisma.InputJsonValue }
            : {}),
          // New timing: moved or skipped runs of the old one no longer apply.
          runChanges: { deleteMany: {} },
        },
      });
      if (countLimitAlreadyMet) {
        await fenceUnstartedScheduleRuns(tx, existing.id, now);
      }
      return updated;
    }
    const activeCount = await tx.sokoBotSchedule.count({
      where: { sokoBotId: bot.id, enabled: true, systemKey: null },
    });
    if (activeCount >= MAX_ACTIVE_SOKO_BOT_SCHEDULES) {
      throw new SokoBotScheduleValidationError(
        `Soko Bot supports at most ${MAX_ACTIVE_SOKO_BOT_SCHEDULES} active schedules`,
      );
    }
    const scheduleId = input.resolveAuthority ? randomUUID() : undefined;
    const nextAuthority =
      input.resolveAuthority && scheduleId
        ? resolveScheduleAuthorityField(input.resolveAuthority, {
            scheduleId,
            sokoBotId: bot.id,
            workspaceId: input.workspaceId,
            existingAuthority: null,
            botProjectId: botDetails?.projectId ?? null,
            botVersionId: botDetails?.versionId ?? null,
            sharedBot: botDetails ? isSharedSokoBot(botDetails) : false,
          })
        : undefined;
    if (
      nextAuthority !== undefined &&
      scheduleId !== undefined &&
      (input.capabilityNames?.length ?? 0) > 0
    ) {
      const botUserId = botDetails?.userId ?? null;
      const capabilityCheck = checkScheduleFirstRunCapabilities({
        scheduleId,
        sokoBotId: bot.id,
        workspaceId: input.workspaceId,
        authority: nextAuthority,
        actingUserId: sokoBotScheduleActingUserId({
          requestedByUserId: input.userId,
          systemKey: null,
          sokoBot: { userId: botUserId },
        }),
        botUserId,
        botProjectId: botDetails?.projectId ?? null,
        botVersionId: botDetails?.versionId ?? null,
        requestedCapabilities: input.capabilityNames ?? [],
      });
      if (!capabilityCheck.ok) {
        throw new SokoBotScheduleValidationError(capabilityCheck.detail);
      }
    }
    return tx.sokoBotSchedule.create({
      data: {
        ...(scheduleId ? { id: scheduleId } : {}),
        sokoBotId: bot.id,
        requestedByUserId: input.userId,
        workspaceId: input.workspaceId,
        name: name.slice(0, 120),
        timezone: input.timezone,
        cronExpression,
        runOnce,
        prompt: prompt.slice(0, 20_000),
        nextRunAt,
        capabilityNames: [...(input.capabilityNames ?? [])],
        ...link,
        ...(nextAuthority !== undefined
          ? { authority: nextAuthority as Prisma.InputJsonValue }
          : {}),
      },
    });
  };
  return transaction
    ? mutate(transaction)
    : serializableTransaction(
        mutate,
        "Soko Bot schedule creation collided with another request",
      );
}

/**
 * Any member with access configures a shared bot, so its schedules are not
 * limited to the member who wrote them. `null` for a personal bot.
 */
async function sharedBotScheduleScope(
  userId: string | null,
  ref: { workspaceId?: string; sokoBotId?: string },
  db: Prisma.TransactionClient | typeof prisma,
): Promise<{ workspaceId: string; sokoBotId: string } | null> {
  if (!ref.workspaceId || !ref.sokoBotId) return null;
  const bot = await scheduleBot(userId, ref.workspaceId, ref.sokoBotId, db);
  return bot && isSharedSokoBot(bot)
    ? { workspaceId: ref.workspaceId, sokoBotId: ref.sokoBotId }
    : null;
}

/** Resolves by id first, then exact (case-insensitive) name; the error lists what exists so a caller can correct itself. */
async function findScheduleForUser(
  userId: string | null,
  ref: {
    scheduleId?: string;
    scheduleName?: string;
    workspaceId?: string;
    sokoBotId?: string;
  },
  transaction?: Prisma.TransactionClient,
) {
  const db = transaction ?? prisma;
  // A member's own lookup reaches their personal bot's schedules, whoever
  // asked for them; a shared bot's schedules need the shared lookup below.
  const own =
    userId === null
      ? null
      : {
          ...(ref.workspaceId !== undefined
            ? { workspaceId: ref.workspaceId }
            : {}),
          ...(ref.sokoBotId !== undefined ? { sokoBotId: ref.sokoBotId } : {}),
          sokoBot: { userId },
        };
  const matching = {
    OR: [
      ...(ref.scheduleId ? [{ id: ref.scheduleId }] : []),
      ...(ref.scheduleName
        ? [
            {
              name: {
                equals: ref.scheduleName.trim(),
                mode: "insensitive" as const,
              },
            },
          ]
        : []),
    ],
  };
  const schedule =
    own &&
    (await db.sokoBotSchedule.findFirst({ where: { ...own, ...matching } }));
  if (schedule) return schedule;
  const shared = await sharedBotScheduleScope(userId, ref, db);
  const sharedSchedule =
    shared &&
    (await db.sokoBotSchedule.findFirst({ where: { ...shared, ...matching } }));
  if (sharedSchedule) return sharedSchedule;
  const scope = shared ?? own;
  const existing = scope
    ? await db.sokoBotSchedule.findMany({
        where: scope,
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const hint =
    existing.length === 0
      ? "There are no schedules."
      : `Existing schedules: ${existing.map((s) => `${s.name} (${s.id})`).join("; ")}.`;
  throw new SokoBotScheduleNotFoundError(`Schedule not found. ${hint}`);
}

export async function updateSokoBotSchedule(
  input: UpdateSokoBotScheduleInput,
  transaction?: Prisma.TransactionClient,
) {
  const db = transaction ?? prisma;
  const schedule = await findScheduleForUser(input.userId, input, transaction);
  await requireSharedBotScheduleSeat(input.userId, schedule.sokoBotId, db);
  if (input.keepBuiltInRhythms && schedule.systemKey)
    throw new SokoBotScheduleValidationError(
      `"${schedule.name}" is one of your built-in rhythms and stays as it is. For something the owner wants on a schedule, such as a reminder, create a separate schedule with create_schedule.`,
    );
  // A built-in rhythm keeps its purpose: Joseph's end-of-day was rewritten
  // into another job (2026-11-08) and the console went on describing the
  // built-in. Its time, timezone and on/off change; anything else is a
  // schedule of its own.
  if (
    schedule.systemKey &&
    ((input.name !== undefined && input.name.trim() !== schedule.name) ||
      (input.prompt !== undefined && input.prompt.trim() !== schedule.prompt))
  )
    throw new SokoBotScheduleValidationError(
      `"${schedule.name}" is a built-in rhythm: only its time, timezone and on/off change. For another job, create a schedule of its own, and pause this one if it should stop.`,
    );
  if (input.run) return changeScheduleRun(schedule, input.run, transaction);
  const timezone = input.timezone ?? schedule.timezone;
  const cronExpression = input.cronExpression ?? schedule.cronExpression;
  if (input.cronExpression) assertNoDayOrTrap(input.cronExpression);
  const now = new Date();
  const nextRunAt = computeNextRunWithMinimumInterval(
    { cron: cronExpression, timezone, from: now },
    MIN_SCHEDULE_INTERVAL_MS,
  );
  if (!nextRunAt) {
    throw new SokoBotScheduleValidationError(
      "Invalid cron expression, timezone, or interval below one minute",
    );
  }
  const timingChanged =
    input.timezone !== undefined || input.cronExpression !== undefined;
  const reactivated =
    input.enabled === true && !schedule.enabled && schedule.nextRunAt <= now;
  // Turned back on: the next run counts the runs moved or skipped meanwhile.
  const restartAt =
    reactivated && !timingChanged
      ? nextEffectiveRun(
          { cronExpression, timezone },
          await db.sokoBotScheduleRunChange.findMany({
            where: { scheduleId: schedule.id },
            select: { originalAt: true, scheduledAt: true },
          }),
          now,
          nextRunAt,
        )
      : nextRunAt;
  const existingAuthority = parseOwnerAuthority(schedule.authority);
  const botDetails =
    input.resolveAuthority ||
    (input.capabilityNames !== undefined &&
      existingAuthority !== null &&
      schedule.systemKey === null)
      ? await db.sokoBot.findUnique({
          where: { id: schedule.sokoBotId },
          select: { userId: true, projectId: true, versionId: true },
        })
      : null;
  const nextAuthority = input.resolveAuthority
    ? resolveScheduleAuthorityField(input.resolveAuthority, {
        scheduleId: schedule.id,
        sokoBotId: schedule.sokoBotId,
        workspaceId: schedule.workspaceId,
        existingAuthority,
        botProjectId: botDetails?.projectId ?? null,
        botVersionId: botDetails?.versionId ?? null,
        sharedBot: botDetails ? isSharedSokoBot(botDetails) : false,
      })
    : undefined;
  const effectiveUpdatedAuthority = nextAuthority ?? existingAuthority;
  if (
    effectiveUpdatedAuthority !== null &&
    schedule.systemKey === null &&
    (input.capabilityNames?.length ?? 0) > 0
  ) {
    const botUserId = botDetails?.userId ?? null;
    const capabilityCheck = checkScheduleFirstRunCapabilities({
      scheduleId: schedule.id,
      sokoBotId: schedule.sokoBotId,
      workspaceId: schedule.workspaceId,
      authority: effectiveUpdatedAuthority,
      actingUserId: sokoBotScheduleActingUserId({
        requestedByUserId: schedule.requestedByUserId,
        systemKey: schedule.systemKey,
        sokoBot: { userId: botUserId },
      }),
      botUserId,
      botProjectId: botDetails?.projectId ?? null,
      botVersionId: botDetails?.versionId ?? null,
      requestedCapabilities: input.capabilityNames ?? [],
      now,
    });
    if (!capabilityCheck.ok) {
      throw new SokoBotScheduleValidationError(capabilityCheck.detail);
    }
  }
  const data = {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.enabled === true && !schedule.enabled
      ? { consecutiveFailures: 0 }
      : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.cronExpression !== undefined
      ? { cronExpression: input.cronExpression }
      : {}),
    // A new cron makes a one-time schedule recurring.
    ...(input.cronExpression ? { runOnce: false } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt.trim() } : {}),
    ...(input.capabilityNames
      ? { capabilityNames: [...input.capabilityNames] }
      : {}),
    ...(nextAuthority !== undefined
      ? { authority: nextAuthority as Prisma.InputJsonValue }
      : {}),
    ...(timingChanged || reactivated
      ? { nextRunAt: restartAt ?? nextRunAt }
      : {}),
    // New timing: moved or skipped runs of the old one no longer apply.
    ...(timingChanged ? { runChanges: { deleteMany: {} } } : {}),
  };
  const effectiveAuthority =
    nextAuthority ?? parseOwnerAuthority(schedule.authority);
  const wantsEnabled = input.enabled ?? schedule.enabled;
  // Metadata-only edits (e.g. a chat rename where resolveAuthority returns
  // undefined) must not re-trigger an already-saved count stop rule; only an
  // explicit authority/rule update or an explicit re-enable does, and only
  // after passing the live grant check shared with settlement and due claims.
  const checksCountLimit =
    wantsEnabled &&
    effectiveAuthority?.stopRule.mode === "ends_after_runs" &&
    (nextAuthority !== undefined || input.enabled === true);
  if ((input.enabled === true && !schedule.enabled) || checksCountLimit) {
    const mutate = async (tx: Prisma.TransactionClient) => {
      let countLimitAlreadyMet = false;
      let currentlyEnabled = schedule.enabled;
      if (checksCountLimit) {
        await tx.$queryRaw`
          SELECT "id" FROM ${sharedTable("soko_bot_schedule")}
          WHERE "id" = ${schedule.id}::uuid
          FOR UPDATE
        `;
        const current = await tx.sokoBotSchedule.findUniqueOrThrow({
          where: { id: schedule.id },
          select: {
            completedRuns: true,
            enabled: true,
            authority: true,
            sokoBot: { select: SCHEDULE_STOP_AUTHORITY_BOT_SELECT },
          },
        });
        const liveCompletedRuns =
          typeof current.completedRuns === "number"
            ? current.completedRuns
            : (schedule.completedRuns ?? 0);
        if (typeof current.enabled === "boolean") {
          currentlyEnabled = current.enabled;
        }
        const liveAuthority =
          nextAuthority ?? current.authority ?? schedule.authority;
        const parsedLive = parseOwnerAuthority(liveAuthority);
        if (
          parsedLive?.stopRule.mode === "ends_after_runs" &&
          liveCompletedRuns >= parsedLive.stopRule.maxRuns
        ) {
          const liveBot =
            current.sokoBot ??
            (await tx.sokoBot.findUnique({
              where: { id: schedule.sokoBotId },
              select: SCHEDULE_STOP_AUTHORITY_BOT_SELECT,
            }));
          countLimitAlreadyMet = await isCountStopRuleAuthorizedAndMet(
            tx,
            {
              id: schedule.id,
              sokoBotId: schedule.sokoBotId,
              workspaceId: schedule.workspaceId,
              completedRuns: liveCompletedRuns,
              authority: liveAuthority,
              sokoBot: liveBot,
            },
            now,
          );
        }
      }
      if (countLimitAlreadyMet) {
        const updated = await tx.sokoBotSchedule.update({
          where: { id: schedule.id },
          data: { ...data, enabled: false },
        });
        await fenceUnstartedScheduleRuns(tx, schedule.id, now);
        return updated;
      }
      if (input.enabled === true && !currentlyEnabled) {
        const activeCount = await tx.sokoBotSchedule.count({
          where: {
            sokoBotId: schedule.sokoBotId,
            enabled: true,
            systemKey: null,
          },
        });
        if (activeCount >= MAX_ACTIVE_SOKO_BOT_SCHEDULES) {
          throw new SokoBotScheduleValidationError(
            `Soko Bot supports at most ${MAX_ACTIVE_SOKO_BOT_SCHEDULES} active schedules`,
          );
        }
      }
      return tx.sokoBotSchedule.update({ where: { id: schedule.id }, data });
    };
    return transaction
      ? mutate(transaction)
      : serializableTransaction(
          mutate,
          "Soko Bot schedule activation collided with another request",
        );
  }
  return db.sokoBotSchedule.update({ where: { id: schedule.id }, data });
}

/** One run's change from the Calendar; see the request schema. */
export interface ScheduleRunChangeInput {
  /** The cron time the run belongs to; for a one-time schedule, its time. */
  originalAt: string;
  /** Where the caller saw it run; null when they saw it skipped. */
  expectedAt: string | null;
  action: "skip" | "move" | "restore";
  scheduledAt?: string;
}

const STALE_RUN = "The run changed; reload to see it";

/**
 * Skips, moves or restores one run and leaves the cron as it is, within the
 * planning window Task Schedule Runs have. A recurring schedule keeps the
 * change as a {@link ScheduleRunChange}; a one-time schedule moves, or is switched off and on.
 *
 * The schedule row is locked first, and the scheduler's claim takes the same
 * lock before it reads the changes and walks on. So either the claim runs
 * first and this change sees the run fired (409), or the change commits
 * first and the claim walks on with it. `expectedAt` refuses a change made
 * on a stale Calendar the same way. A one-time run is skipped by switching
 * its schedule off with the time kept, and put back by switching it on.
 */
async function changeScheduleRun(
  schedule: {
    id: string;
    systemKey: string | null;
    taskId: string | null;
    jobId: string | null;
  },
  change: ScheduleRunChangeInput,
  transaction?: Prisma.TransactionClient,
) {
  if (schedule.systemKey || schedule.taskId || schedule.jobId) {
    throw new SokoBotScheduleValidationError(
      "Only runs of schedules a member or the bot set up can be moved or skipped",
    );
  }
  const mutate = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`
      SELECT "id" FROM ${sharedTable("soko_bot_schedule")}
      WHERE "id" = ${schedule.id}::uuid
      FOR UPDATE
    `;
    const current = await tx.sokoBotSchedule.findUniqueOrThrow({
      where: { id: schedule.id },
      include: {
        runChanges: { select: { originalAt: true, scheduledAt: true } },
      },
    });
    const now = new Date();
    const horizon = new Date(now.getTime() + RUN_HORIZON_MS);
    const originalAt = new Date(change.originalAt);
    const expectedAt = change.expectedAt ? new Date(change.expectedAt) : null;
    if (current.runOnce) {
      // A skipped one-time run is its schedule switched off with the time
      // kept, so the scheduler never claims it and Undo switches it back on.
      // A spent one (`lastRunAt`) is history.
      const shownAt = current.enabled ? current.nextRunAt : null;
      if (
        current.lastRunAt ||
        originalAt.getTime() !== current.nextRunAt.getTime() ||
        expectedAt?.getTime() !== shownAt?.getTime() ||
        current.nextRunAt <= now
      ) {
        throw conflict(STALE_RUN);
      }
      if (change.action === "skip") {
        if (!shownAt) throw conflict(STALE_RUN);
        return tx.sokoBotSchedule.update({
          where: { id: current.id },
          data: { enabled: false },
        });
      }
      // Switching a skipped run back on counts as activating the schedule.
      if (
        !shownAt &&
        (await tx.sokoBotSchedule.count({
          where: {
            sokoBotId: current.sokoBotId,
            enabled: true,
            systemKey: null,
          },
        })) >= MAX_ACTIVE_SOKO_BOT_SCHEDULES
      ) {
        throw new SokoBotScheduleValidationError(
          `Soko Bot supports at most ${MAX_ACTIVE_SOKO_BOT_SCHEDULES} active schedules`,
        );
      }
      if (change.action === "restore") {
        return tx.sokoBotSchedule.update({
          where: { id: current.id },
          data: { enabled: true },
        });
      }
      const at = new Date(change.scheduledAt ?? "");
      if (
        Number.isNaN(at.getTime()) ||
        at <= now ||
        at.getTime() - now.getTime() > MAX_ONE_TIME_LEAD_MS
      ) {
        throw new SokoBotScheduleValidationError(
          "Move the run to a time in the future, within a year",
        );
      }
      // A one-time schedule's cron only mirrors its time for display.
      return tx.sokoBotSchedule.update({
        where: { id: current.id },
        data: {
          enabled: true,
          nextRunAt: at,
          cronExpression: wallClockCron(at, current.timezone),
        },
      });
    }
    if (!current.enabled) throw conflict(STALE_RUN);

    const existing = current.runChanges.find(
      (row) => row.originalAt.getTime() === originalAt.getTime(),
    );
    if (!existing && !isCronTime(current, originalAt)) {
      throw new SokoBotScheduleValidationError(
        "The schedule has no run at originalAt",
      );
    }
    // Where the run fires now; null when it is skipped.
    const shownAt = existing ? existing.scheduledAt : originalAt;
    if (
      shownAt?.getTime() !== expectedAt?.getTime() ||
      // A run that is due or fired belongs to the scheduler.
      (shownAt && shownAt <= now)
    ) {
      throw conflict(STALE_RUN);
    }
    if (shownAt && shownAt > horizon) {
      throw new SokoBotScheduleValidationError(
        "Only runs in the next 90 days can be moved or skipped",
      );
    }

    let target: Date | null;
    if (change.action === "skip") {
      if (!shownAt) throw conflict(STALE_RUN);
      target = null;
    } else if (change.action === "restore") {
      if (originalAt <= now) {
        throw new SokoBotScheduleValidationError(
          "This run's own time has passed",
        );
      }
      target = originalAt;
    } else {
      target = new Date(change.scheduledAt ?? "");
      if (Number.isNaN(target.getTime()) || target <= now || target > horizon) {
        throw new SokoBotScheduleValidationError(
          "Move the run to a time in the future, within the next 90 days",
        );
      }
    }
    if (target && target.getTime() !== shownAt?.getTime()) {
      const taken = effectiveRuns(
        current,
        current.runChanges,
        new Date(target.getTime() - 1),
        new Date(target.getTime() + 1),
        2,
      ).some((run) => run.originalAt.getTime() !== originalAt.getTime());
      if (taken) {
        throw new SokoBotScheduleValidationError(
          "Another run of this schedule is already at that time",
        );
      }
    }

    const others = current.runChanges.filter((row) => row !== existing);
    const backAtItsTime = target?.getTime() === originalAt.getTime();
    const changes: ScheduleRunChange[] = backAtItsTime
      ? others
      : [...others, { originalAt, scheduledAt: target }];
    if (backAtItsTime) {
      await tx.sokoBotScheduleRunChange.deleteMany({
        where: { scheduleId: current.id, originalAt },
      });
    } else {
      await tx.sokoBotScheduleRunChange.upsert({
        where: {
          scheduleId_originalAt: { scheduleId: current.id, originalAt },
        },
        create: { scheduleId: current.id, originalAt, scheduledAt: target },
        update: { scheduledAt: target },
      });
    }
    // A due run is the scheduler's: it walks on from there with these
    // changes. Otherwise the next run is the first one still to come.
    const nextRunAt =
      current.nextRunAt <= now
        ? current.nextRunAt
        : (nextEffectiveRun(current, changes, now) ?? current.nextRunAt);
    return tx.sokoBotSchedule.update({
      where: { id: current.id },
      data: { nextRunAt },
    });
  };
  // Serializable, as every activation is: switching a skipped one-time run
  // back on counts the active schedules, and two concurrent ones must not
  // both pass the cap.
  return transaction
    ? mutate(transaction)
    : serializableTransaction(mutate, STALE_RUN);
}

export async function deleteSokoBotSchedule(
  userId: string | null,
  ref: {
    scheduleId?: string;
    scheduleName?: string;
    workspaceId?: string;
    sokoBotId?: string;
  },
  transaction?: Prisma.TransactionClient,
): Promise<{ id: string; name: string }> {
  const db = transaction ?? prisma;
  const schedule = await findScheduleForUser(userId, ref, transaction);
  if (schedule.systemKey) {
    throw new SokoBotScheduleValidationError(
      `"${schedule.name}" is a built-in rhythm: it can be paused (update_schedule with enabled false), not deleted. Pause it and tell the owner it is paused and can be turned back on.`,
    );
  }
  await db.sokoBotSchedule.delete({ where: { id: schedule.id } });
  return { id: schedule.id, name: schedule.name };
}

export interface LiveScheduleStopAuthorityInput {
  schedule: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    authority: unknown;
    sokoBot: {
      userId: string | null;
      archivedAt: Date | null;
      status: string;
      adminPausedAt: Date | null;
      projectId: string | null;
      versionId: string | null;
    } | null;
  };
  sokoBotId?: string;
  workspaceId?: string;
  actingUserId?: string | null;
  askedByKind?: "OWNER" | "TEAMMATE" | "ASSISTANT";
  versionId?: string | null;
  offeredCapabilities: readonly SokoBotCapability[];
  now: Date;
  checkOrganizationSeat?: (
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ) => Promise<boolean>;
}

/**
 * Verifies a schedule's persisted `OwnerAuthority` against live bot state,
 * live grantor workspace membership and assigned organization seat, and
 * `intersectOwnerAuthority`. Shared by both direct scheduled-run self-stop
 * (`requireScheduledRunMayEnd`) and automatic settlement-time stopping
 * (`recordCompletedScheduleRun`).
 */
export async function verifyScheduleStopAuthority(
  tx: Prisma.TransactionClient,
  input: LiveScheduleStopAuthorityInput,
): Promise<
  | { effective: false }
  | { effective: true; authority: OwnerAuthority; botAlive: boolean }
> {
  const authority = parseOwnerAuthority(input.schedule.authority);
  if (!authority) {
    return { effective: false };
  }
  const bot = input.schedule.sokoBot;
  const botAlive = Boolean(
    bot &&
      bot.archivedAt === null &&
      bot.status !== "PAUSED" &&
      bot.adminPausedAt === null,
  );
  const sharedBot = bot ? bot.userId === null : false;
  const versionId = input.versionId ?? bot?.versionId ?? null;
  const isCmo = getSokoBotVersion(versionId).profile === "cmo";

  let hasWorkspaceAccess = false;
  if (authority.ownerUserId) {
    const workspace = await tx.workspace.findFirst({
      where: sokoBotWorkspaceAccessWhere(
        authority.ownerUserId,
        input.schedule.workspaceId,
      ),
      select: { id: true, organizationId: true },
    });
    if (workspace) {
      const checkSeat =
        input.checkOrganizationSeat ?? hasAssignedOrganizationSeat;
      hasWorkspaceAccess = await checkSeat(
        authority.ownerUserId,
        workspace.organizationId,
        tx,
      );
    }
  }

  const liveTargetScope =
    authority.targetScope.kind === "schedule"
      ? { kind: "schedule" as const, scheduleId: input.schedule.id }
      : bot?.projectId
        ? { kind: "project" as const, projectId: bot.projectId }
        : { kind: "workspace" as const };

  const effective = intersectOwnerAuthority(authority, {
    sokoBotId: input.sokoBotId ?? input.schedule.sokoBotId,
    workspaceId: input.workspaceId ?? input.schedule.workspaceId,
    versionId,
    actingUserId: sharedBot
      ? authority.ownerUserId
      : (input.actingUserId ?? authority.ownerUserId),
    askedByKind: sharedBot
      ? isCmo
        ? "TEAMMATE"
        : "OWNER"
      : (input.askedByKind ?? "OWNER"),
    sharedBot,
    source: "SCHEDULE",
    scheduleId: input.schedule.id,
    targetScope: liveTargetScope,
    hasWorkspaceAccess,
    botAlive,
    offeredCapabilities: input.offeredCapabilities,
    now: input.now,
  });
  if (!effective.effective) {
    return { effective: false };
  }
  return {
    effective: true,
    authority: effective.authority,
    botAlive,
  };
}

async function fenceUnstartedScheduleRuns(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  now: Date,
): Promise<void> {
  // Fence any unstarted occurrence queued while the final run was active so
  // recovery or concurrent binding cannot launch a run past maxRuns.
  await tx.sokoBotScheduleRun.updateMany({
    where: {
      scheduleId,
      status: { in: ["PENDING", "CLAIMED"] },
      turnId: null,
    },
    data: {
      status: "DEAD_LETTER",
      completedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      errorKind: "schedule_stop_rule_met",
    },
  });
}

const SCHEDULE_STOP_AUTHORITY_BOT_SELECT = {
  userId: true,
  archivedAt: true,
  status: true,
  adminPausedAt: true,
  projectId: true,
  versionId: true,
} as const;

async function isCountStopRuleAuthorizedAndMet(
  tx: Prisma.TransactionClient,
  schedule: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    completedRuns: number;
    authority: unknown;
    sokoBot: {
      userId: string | null;
      archivedAt: Date | null;
      status: string;
      adminPausedAt: Date | null;
      projectId: string | null;
      versionId: string | null;
    } | null;
  },
  now: Date,
  options?: {
    checkOrganizationSeat?: (
      userId: string,
      organizationId: string | null,
      tx: Prisma.TransactionClient,
    ) => Promise<boolean>;
  },
): Promise<boolean> {
  const parsed = parseOwnerAuthority(schedule?.authority);
  if (parsed?.stopRule.mode !== "ends_after_runs") {
    return false;
  }
  const verified = await verifyScheduleStopAuthority(tx, {
    schedule,
    offeredCapabilities: ["update_schedule"],
    now,
    checkOrganizationSeat: options?.checkOrganizationSeat,
  });
  if (!verified.effective) {
    return false;
  }
  const evaluation = evaluateScheduleStopRule(verified.authority, {
    sokoBotId: schedule.sokoBotId,
    workspaceId: schedule.workspaceId,
    ownScheduleId: schedule.id,
    targetScheduleId: schedule.id,
    revoked: !verified.botAlive,
    completedRuns: schedule.completedRuns,
    now,
  });
  return evaluation.allowed;
}

async function disableScheduleIfStopRuleMetTx(
  tx: Prisma.TransactionClient,
  schedule: {
    id: string;
    sokoBotId: string;
    workspaceId: string;
    enabled: boolean;
    completedRuns: number;
    authority: unknown;
    sokoBot: {
      userId: string | null;
      archivedAt: Date | null;
      status: string;
      adminPausedAt: Date | null;
      projectId: string | null;
      versionId: string | null;
    } | null;
  },
  now: Date,
  options?: {
    checkOrganizationSeat?: (
      userId: string,
      organizationId: string | null,
      tx: Prisma.TransactionClient,
    ) => Promise<boolean>;
  },
): Promise<{ stopped: boolean }> {
  if (!schedule?.enabled) {
    return { stopped: false };
  }
  if (!(await isCountStopRuleAuthorizedAndMet(tx, schedule, now, options))) {
    return { stopped: false };
  }
  await tx.sokoBotSchedule.update({
    where: { id: schedule.id },
    data: { enabled: false },
  });
  await fenceUnstartedScheduleRuns(tx, schedule.id, now);
  return { stopped: true };
}

/**
 * Defense-in-depth check before claiming a due occurrence: if the schedule's
 * persisted `ends_after_runs` count is already met AND live authority verifies,
 * disables the schedule and fences unstarted runs atomically so no extra
 * occurrence can start.
 */
export async function disableScheduleIfCountLimitMet(
  scheduleId: string,
  now: Date = new Date(),
  options?: {
    checkOrganizationSeat?: (
      userId: string,
      organizationId: string | null,
      tx: Prisma.TransactionClient,
    ) => Promise<boolean>;
  },
): Promise<boolean> {
  const result = await serializableTransaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM ${sharedTable("soko_bot_schedule")}
      WHERE "id" = ${scheduleId}::uuid
      FOR UPDATE
    `;
    const schedule = await tx.sokoBotSchedule.findUnique({
      where: { id: scheduleId },
      select: {
        id: true,
        sokoBotId: true,
        workspaceId: true,
        enabled: true,
        completedRuns: true,
        authority: true,
        sokoBot: {
          select: {
            userId: true,
            archivedAt: true,
            status: true,
            adminPausedAt: true,
            projectId: true,
            versionId: true,
          },
        },
      },
    });
    if (!schedule) return { stopped: false };
    return disableScheduleIfStopRuleMetTx(tx, schedule, now, options);
  }, "Soko Bot schedule count-limit check collided with another request");
  return result.stopped;
}

/**
 * Records one distinct successful schedule occurrence on `SokoBotSchedule`
 * (durable across the 7-day `SokoBotScheduleRun` retention purge) and, when
 * the schedule's persisted `ends_after_runs` stop rule is satisfied AND its
 * grantor's live authority (workspace access, assigned seat, bot state) still
 * verifies, disables the schedule and fences any unstarted pending/claimed
 * occurrences atomically.
 */
export async function recordCompletedScheduleRun(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  now: Date = new Date(),
  options?: {
    checkOrganizationSeat?: (
      userId: string,
      organizationId: string | null,
      tx: Prisma.TransactionClient,
    ) => Promise<boolean>;
  },
): Promise<{ stopped: boolean }> {
  const updated = await tx.sokoBotSchedule.update({
    where: { id: scheduleId },
    data: {
      consecutiveFailures: 0,
      completedRuns: { increment: 1 },
    },
    select: {
      id: true,
      sokoBotId: true,
      workspaceId: true,
      enabled: true,
      completedRuns: true,
      authority: true,
      sokoBot: {
        select: {
          userId: true,
          archivedAt: true,
          status: true,
          adminPausedAt: true,
          projectId: true,
          versionId: true,
        },
      },
    },
  });
  return disableScheduleIfStopRuleMetTx(tx, updated, now, options);
}

/** How long a disabled schedule and a settled run stay visible. */
export const SOKO_BOT_SCHEDULE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const PURGE_BATCH = 200;
const RUN_PURGE_BATCH = 1_000;
const ACTIVE_RUN_STATUSES = ["PENDING", "CLAIMED", "RUNNING"] as const;
const SETTLED_RUN_STATUSES = ["COMPLETED", "FAILED", "DEAD_LETTER"] as const;

export interface SokoBotSchedulePurgeResult {
  spentOneTime: number;
  watchedWorkFinished: number;
  failedRecurring: number;
  settledRuns: number;
  runChanges: number;
}

/**
 * Removes schedules nobody will run again, so a bot that sets many one-time
 * follow-ups does not leave a disabled row behind for each:
 *
 * - one-time schedules whose run settled, after the retention window, so
 *   the Calendar shows the run for a week and an admin can retry a failure;
 * - schedules watching a Task or Job that finished;
 * - recurring schedules the failure budget switched off, after retention.
 *
 * A schedule someone paused stays: that is a choice, not a leftover. Built-in
 * rhythms and schedules with a run in flight are never touched. Each call
 * removes at most one batch per rule; the next cron tick takes the rest.
 */
export async function purgeSokoBotSchedules(
  now = new Date(),
): Promise<SokoBotSchedulePurgeResult> {
  const retentionCutoff = new Date(
    now.getTime() - SOKO_BOT_SCHEDULE_RETENTION_MS,
  );
  const idle = {
    systemKey: null,
    runs: { none: { status: { in: [...ACTIVE_RUN_STATUSES] } } },
  } satisfies Prisma.SokoBotScheduleWhereInput;
  const purge = async (where: Prisma.SokoBotScheduleWhereInput) => {
    const due = await prisma.sokoBotSchedule.findMany({
      where: { ...idle, ...where },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PURGE_BATCH,
    });
    if (!due.length) return 0;
    const deleted = await prisma.sokoBotSchedule.deleteMany({
      where: { ...idle, ...where, id: { in: due.map((row) => row.id) } },
    });
    return deleted.count;
  };
  const spentOneTime = await purge({
    runOnce: true,
    enabled: false,
    lastRunAt: { not: null },
    // Its run row is the Calendar's history of it, kept as long as any run.
    updatedAt: { lt: retentionCutoff },
  });
  const watchedWorkFinished = await purge({
    OR: [
      {
        task: {
          OR: [
            { status: { in: ["COMPLETED", "CANCELED"] } },
            { archivedAt: { not: null } },
          ],
        },
      },
      {
        job: {
          events: { some: { status: { in: ["COMPLETED", "FAILED"] } } },
        },
      },
    ],
  });
  const failedRecurring = await purge({
    runOnce: false,
    enabled: false,
    consecutiveFailures: { gte: MAX_CONSECUTIVE_SCHEDULE_FAILURES },
    updatedAt: { lt: retentionCutoff },
  });
  const oldRuns = await prisma.sokoBotScheduleRun.findMany({
    where: {
      status: { in: [...SETTLED_RUN_STATUSES] },
      scheduledFor: { lt: retentionCutoff },
    },
    select: { id: true },
    orderBy: { scheduledFor: "asc" },
    take: RUN_PURGE_BATCH,
  });
  const settledRuns = oldRuns.length
    ? (
        await prisma.sokoBotScheduleRun.deleteMany({
          where: {
            id: { in: oldRuns.map((run) => run.id) },
            status: { in: [...SETTLED_RUN_STATUSES] },
          },
        })
      ).count
    : 0;
  // A change both of whose times passed no longer steers anything.
  const runChanges = (
    await prisma.sokoBotScheduleRunChange.deleteMany({
      where: {
        originalAt: { lt: retentionCutoff },
        OR: [{ scheduledAt: null }, { scheduledAt: { lt: retentionCutoff } }],
      },
    })
  ).count;
  return {
    spentOneTime,
    watchedWorkFinished,
    failedRecurring,
    settledRuns,
    runChanges,
  };
}
