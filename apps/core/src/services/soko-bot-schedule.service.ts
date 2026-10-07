import type { Prisma } from "@sokosumi/database";
import { computeNextRunWithMinimumInterval } from "@/helpers/cron";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

const MIN_SCHEDULE_INTERVAL_MS = 60_000;
export const MAX_ACTIVE_SOKO_BOT_SCHEDULES = 10;

export class SokoBotScheduleNotFoundError extends Error {}
export class SokoBotScheduleValidationError extends Error {}

export interface CreateSokoBotScheduleInput {
  userId: string;
  workspaceId: string;
  name: string;
  timezone: string;
  /** Recurring runs; exactly one of `cronExpression` and `runAt`. */
  cronExpression?: string;
  /** One run at this instant (ISO 8601), then the schedule disables itself. */
  runAt?: string;
  prompt: string;
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
  userId: string;
  scheduleId?: string;
  scheduleName?: string;
  workspaceId?: string;
  sokoBotId?: string;
  name?: string;
  enabled?: boolean;
  timezone?: string;
  cronExpression?: string;
  prompt?: string;
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
  const bot = await db.sokoBot.findFirst({
    where: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!bot) throw new SokoBotScheduleNotFoundError("Soko Bot not found");
  const workspace = await db.workspace.findFirst({
    where: {
      id: input.workspaceId,
      OR: [
        { userId: input.userId },
        { organization: { members: { some: { userId: input.userId } } } },
      ],
    },
    select: { id: true },
  });
  if (!workspace) throw new SokoBotScheduleNotFoundError("Workspace not found");
  const mutate = async (tx: Prisma.TransactionClient) => {
    // Same name = same follow-up: a model retrying or re-planning updates
    // the existing schedule instead of stacking duplicates.
    const existing = await tx.sokoBotSchedule.findFirst({
      where: { sokoBotId: bot.id, name: name.slice(0, 120) },
      select: { id: true },
    });
    if (existing) {
      return tx.sokoBotSchedule.update({
        where: { id: existing.id },
        data: {
          enabled: true,
          consecutiveFailures: 0,
          workspaceId: input.workspaceId,
          timezone: input.timezone,
          cronExpression,
          runOnce,
          prompt: prompt.slice(0, 20_000),
          nextRunAt,
        },
      });
    }
    const activeCount = await tx.sokoBotSchedule.count({
      where: { sokoBotId: bot.id, enabled: true },
    });
    if (activeCount >= MAX_ACTIVE_SOKO_BOT_SCHEDULES) {
      throw new SokoBotScheduleValidationError(
        `Soko Bot supports at most ${MAX_ACTIVE_SOKO_BOT_SCHEDULES} active schedules`,
      );
    }
    return tx.sokoBotSchedule.create({
      data: {
        sokoBotId: bot.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        name: name.slice(0, 120),
        timezone: input.timezone,
        cronExpression,
        runOnce,
        prompt: prompt.slice(0, 20_000),
        nextRunAt,
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

/** Resolves by id first, then exact (case-insensitive) name; the error lists what exists so a caller can correct itself. */
async function findScheduleForUser(
  userId: string,
  ref: {
    scheduleId?: string;
    scheduleName?: string;
    workspaceId?: string;
    sokoBotId?: string;
  },
  transaction?: Prisma.TransactionClient,
) {
  const db = transaction ?? prisma;
  const schedule = await db.sokoBotSchedule.findFirst({
    where: {
      userId,
      workspaceId: ref.workspaceId,
      sokoBotId: ref.sokoBotId,
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
    },
  });
  if (schedule) return schedule;
  const existing = await db.sokoBotSchedule.findMany({
    where: { userId, workspaceId: ref.workspaceId, sokoBotId: ref.sokoBotId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
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
  const data = {
    name: input.name?.trim(),
    enabled: input.enabled,
    consecutiveFailures:
      input.enabled === true && !schedule.enabled ? 0 : undefined,
    timezone: input.timezone,
    cronExpression: input.cronExpression,
    // A new cron makes a one-time schedule recurring.
    runOnce: input.cronExpression ? false : undefined,
    prompt: input.prompt?.trim(),
    nextRunAt:
      input.timezone !== undefined ||
      input.cronExpression !== undefined ||
      (input.enabled === true && !schedule.enabled && schedule.nextRunAt <= now)
        ? nextRunAt
        : undefined,
  };
  if (input.enabled === true && !schedule.enabled) {
    const mutate = async (tx: Prisma.TransactionClient) => {
      const activeCount = await tx.sokoBotSchedule.count({
        where: { sokoBotId: schedule.sokoBotId, enabled: true },
      });
      if (activeCount >= MAX_ACTIVE_SOKO_BOT_SCHEDULES) {
        throw new SokoBotScheduleValidationError(
          `Soko Bot supports at most ${MAX_ACTIVE_SOKO_BOT_SCHEDULES} active schedules`,
        );
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

export async function deleteSokoBotSchedule(
  userId: string,
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
      `"${schedule.name}" is a built-in rhythm; pause it instead of deleting it`,
    );
  }
  await db.sokoBotSchedule.delete({ where: { id: schedule.id } });
  return { id: schedule.id, name: schedule.name };
}

/** Bot-facing view: what runs, when, and what it will be asked. */
export function listSokoBotSchedules(sokoBotId: string) {
  return prisma.sokoBotSchedule.findMany({
    where: { sokoBotId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      enabled: true,
      timezone: true,
      cronExpression: true,
      runOnce: true,
      prompt: true,
      nextRunAt: true,
      lastRunAt: true,
    },
  });
}
