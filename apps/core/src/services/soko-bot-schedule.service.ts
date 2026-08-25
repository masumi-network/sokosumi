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
  scheduleId: string;
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

export async function updateSokoBotSchedule(input: UpdateSokoBotScheduleInput) {
  const schedule = await prisma.sokoBotSchedule.findFirst({
    where: { id: input.scheduleId, userId: input.userId },
  });
  if (!schedule) throw new SokoBotScheduleNotFoundError("Schedule not found");
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
  scheduleId: string,
): Promise<void> {
  const deleted = await prisma.sokoBotSchedule.deleteMany({
    where: { id: scheduleId, userId },
  });
  if (deleted.count === 0) {
    throw new SokoBotScheduleNotFoundError("Schedule not found");
  }
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
