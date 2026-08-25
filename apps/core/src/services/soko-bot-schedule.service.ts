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
  cronExpression: string;
  prompt: string;
}

export interface UpdateSokoBotScheduleInput {
  userId: string;
  scheduleId?: string;
  scheduleName?: string;
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
export async function createSokoBotSchedule(input: CreateSokoBotScheduleInput) {
  const nextRunAt = computeNextRunWithMinimumInterval(
    { cron: input.cronExpression, timezone: input.timezone },
    MIN_SCHEDULE_INTERVAL_MS,
  );
  if (!nextRunAt) {
    throw new SokoBotScheduleValidationError(
      "Invalid cron expression, timezone, or interval below one minute",
    );
  }
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (!name || !prompt) {
    throw new SokoBotScheduleValidationError(
      "Schedule name and prompt are required",
    );
  }
  const bot = await prisma.sokoBot.findFirst({
    where: { userId: input.userId, archivedAt: null },
    select: { id: true },
  });
  if (!bot) throw new SokoBotScheduleNotFoundError("Soko Bot not found");
  const workspace = await prisma.workspace.findFirst({
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
  return serializableTransaction(async (tx) => {
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
          cronExpression: input.cronExpression,
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
        cronExpression: input.cronExpression,
        prompt: prompt.slice(0, 20_000),
        nextRunAt,
      },
    });
  }, "Soko Bot schedule creation collided with another request");
}

/** Resolves by id first, then exact (case-insensitive) name; the error lists what exists so a caller can correct itself. */
async function findScheduleForUser(
  userId: string,
  ref: { scheduleId?: string; scheduleName?: string },
) {
  const schedule = await prisma.sokoBotSchedule.findFirst({
    where: {
      userId,
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
  const existing = await prisma.sokoBotSchedule.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const hint =
    existing.length === 0
      ? "There are no schedules."
      : `Existing schedules: ${existing.map((s) => `${s.name} (${s.id})`).join("; ")}.`;
  throw new SokoBotScheduleNotFoundError(`Schedule not found. ${hint}`);
}

export async function updateSokoBotSchedule(input: UpdateSokoBotScheduleInput) {
  const schedule = await findScheduleForUser(input.userId, input);
  const timezone = input.timezone ?? schedule.timezone;
  const cronExpression = input.cronExpression ?? schedule.cronExpression;
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
    prompt: input.prompt?.trim(),
    nextRunAt:
      input.timezone !== undefined ||
      input.cronExpression !== undefined ||
      (input.enabled === true && !schedule.enabled && schedule.nextRunAt <= now)
        ? nextRunAt
        : undefined,
  };
  if (input.enabled === true && !schedule.enabled) {
    return serializableTransaction(async (tx) => {
      const activeCount = await tx.sokoBotSchedule.count({
        where: { sokoBotId: schedule.sokoBotId, enabled: true },
      });
      if (activeCount >= MAX_ACTIVE_SOKO_BOT_SCHEDULES) {
        throw new SokoBotScheduleValidationError(
          `Soko Bot supports at most ${MAX_ACTIVE_SOKO_BOT_SCHEDULES} active schedules`,
        );
      }
      return tx.sokoBotSchedule.update({ where: { id: schedule.id }, data });
    }, "Soko Bot schedule activation collided with another request");
  }
  return prisma.sokoBotSchedule.update({ where: { id: schedule.id }, data });
}

export async function deleteSokoBotSchedule(
  userId: string,
  ref: { scheduleId?: string; scheduleName?: string },
): Promise<{ id: string; name: string }> {
  const schedule = await findScheduleForUser(userId, ref);
  await prisma.sokoBotSchedule.delete({ where: { id: schedule.id } });
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
      prompt: true,
      nextRunAt: true,
      lastRunAt: true,
    },
  });
}
