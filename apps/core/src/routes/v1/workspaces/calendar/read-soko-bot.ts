import { computeNextRun } from "@/helpers/cron";
import prisma from "@/lib/db/prisma";
import { sokoBotRunCalendarItemSchema } from "@/schemas/workspace-calendar.schema";

import {
  type CalendarEntry,
  type CalendarReader,
  calendarEntrySource,
  pageInMemory,
} from "./read-shared.js";

/** A schedule may fire every minute; the Calendar shows its first runs only. */
export const MAX_RUNS_PER_SCHEDULE = 100;

/**
 * The caller's own Soko Bot's coming runs: only their personal bot, only the
 * schedules they or it set up. Built-in rhythms and schedules that follow a
 * Task or Job are the bot's housekeeping, not the owner's plans, so they stay
 * off. Runs come from `nextRunAt` and the cron, so past days show none.
 */
export const readSokoBot: CalendarReader = async (ctx) => {
  const { workspaceId, userId, query } = ctx;
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: {
      workspaceId,
      enabled: true,
      systemKey: null,
      taskId: null,
      jobId: null,
      nextRunAt: { lt: query.to },
      sokoBot: { userId, workspaceId, archivedAt: null, deletedAt: null },
    },
    select: {
      id: true,
      name: true,
      timezone: true,
      cronExpression: true,
      runOnce: true,
      nextRunAt: true,
    },
  });
  const source = calendarEntrySource({ workspaceId, projectId: null });
  return pageInMemory(
    schedules.flatMap((schedule) =>
      runTimes(schedule, query.from, query.to).map(
        (at): CalendarEntry =>
          sokoBotRunCalendarItemSchema.parse({
            kind: "sokoBotRun",
            id: `sokobot:${schedule.id}:${at.toISOString()}`,
            scheduledAt: at.toISOString(),
            scheduleId: schedule.id,
            name: schedule.name,
            ...source,
          }),
      ),
    ),
    ctx,
  );
};

/** The schedule's run times in [from, to), from its next run on. */
export function runTimes(
  schedule: {
    cronExpression: string;
    timezone: string;
    runOnce: boolean;
    nextRunAt: Date;
  },
  from: Date,
  to: Date,
): Date[] {
  if (schedule.runOnce) {
    return schedule.nextRunAt >= from && schedule.nextRunAt < to
      ? [schedule.nextRunAt]
      : [];
  }
  const times: Date[] = [];
  // cron's next is strictly after its start, so start just before the first.
  let after = new Date(
    Math.max(from.getTime(), schedule.nextRunAt.getTime()) - 1,
  );
  while (times.length < MAX_RUNS_PER_SCHEDULE) {
    const next = computeNextRun({
      cron: schedule.cronExpression,
      timezone: schedule.timezone,
      from: after,
    });
    if (!next || next >= to) break;
    times.push(next);
    after = next;
  }
  return times;
}
