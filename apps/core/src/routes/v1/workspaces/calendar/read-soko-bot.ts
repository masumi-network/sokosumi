import { getEnv } from "@/config/env";
import { computeNextRun } from "@/helpers/cron";
import prisma from "@/lib/db/prisma";
import { sokoBotRunCalendarItemSchema } from "@/schemas/workspace-calendar.schema";

import {
  type CalendarEntry,
  type CalendarReader,
  calendarEntrySource,
  NO_ENTRIES,
  pageInMemory,
} from "./read-shared.js";

/**
 * The caller's own Soko Bot's coming runs: only their personal bot, only the
 * schedules they or it set up. Built-in rhythms and schedules that follow a
 * Task or Job are the bot's housekeeping, not the owner's plans, so they stay
 * off, and so does a bot the runner would skip: paused by an admin or the
 * runtime, by its owner, or by the platform kill switch. Runs come from
 * `nextRunAt` and the cron, so past days show none.
 *
 * A schedule may fire every minute, so each one is walked from the page's
 * cursor and only as far as one page can use; later pages continue the walk.
 * `total` therefore counts at most a page of runs per schedule.
 */
export const readSokoBot: CalendarReader = async (ctx) => {
  const { workspaceId, userId, query } = ctx;
  if (getEnv().SOKO_BOT_PROACTIVE_PAUSED) return NO_ENTRIES;
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: {
      workspaceId,
      enabled: true,
      systemKey: null,
      taskId: null,
      jobId: null,
      nextRunAt: { lt: query.to },
      sokoBot: {
        userId,
        workspaceId,
        archivedAt: null,
        deletedAt: null,
        status: { not: "PAUSED" },
        proactivePaused: false,
      },
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
  const from = query.cursor
    ? new Date(
        Math.max(query.from.getTime(), Date.parse(query.cursor.scheduledAt)),
      )
    : query.from;
  return pageInMemory(
    schedules.flatMap((schedule) =>
      // The walk includes the cursor's own run, which the page then drops;
      // one more than a page beyond it tells whether another page follows.
      runTimes(schedule, from, query.to, query.limit + 2).map(
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

/** The schedule's first `max` run times in [from, to), from its next run on. */
export function runTimes(
  schedule: {
    cronExpression: string;
    timezone: string;
    runOnce: boolean;
    nextRunAt: Date;
  },
  from: Date,
  to: Date,
  max: number,
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
  while (times.length < max) {
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
