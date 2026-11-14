import type { Prisma, SokoBotScheduleRunStatus } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

import { getEnv } from "@/config/env";
import { computeNextRun } from "@/helpers/cron";
import prisma from "@/lib/db/prisma";
import { sokoBotRunCalendarItemSchema } from "@/schemas/workspace-calendar.schema";

import {
  type CalendarEntry,
  type CalendarReader,
  calendarEntrySource,
  pageInMemory,
} from "./read-shared.js";

const RUN_STATE = {
  PENDING: "running",
  CLAIMED: "running",
  RUNNING: "running",
  COMPLETED: "done",
  FAILED: "failed",
  DEAD_LETTER: "failed",
} as const satisfies Record<SokoBotScheduleRunStatus, string>;

/**
 * The Soko Bots whose runs a member sees: their own personal bot, and every
 * Project and workspace bot of the workspace when it belongs to an
 * Organization, as `memberSokoBot` reaches them. Someone else's personal bot
 * never. The route already proved the member reaches the workspace.
 */
function visibleBotWhere(
  userId: string,
  workspaceId: string,
  options: { projectId?: string; sourceId?: string },
): Prisma.SokoBotWhereInput {
  return {
    workspaceId,
    archivedAt: null,
    deletedAt: null,
    // A Project's calendar shows its own bot; the workspace source, none.
    ...(options.projectId
      ? { projectId: options.projectId }
      : options.sourceId
        ? { projectId: null }
        : {}),
    OR: [
      { userId },
      { userId: null, workspace: { organizationId: { not: null } } },
    ],
  };
}

/**
 * Soko Bot schedule runs the member may see: the ones still to come, from
 * `nextRunAt` and the cron, and the ones that already ran, from their run
 * rows (kept for a week). Only schedules a member or the bot set up; built-in
 * rhythms and schedules that follow a Task or Job are housekeeping. Runs to
 * come leave out a bot the runner would skip: paused by an admin or the
 * runtime, by its owner, or by the platform kill switch.
 *
 * Only a bot's next run can be moved or skipped (`canChange`): the scheduler
 * keeps one `nextRunAt` per schedule and walks the cron on from there. Cuso's
 * schedules are CMO's and stay read-only, as on his console.
 *
 * A schedule may fire every minute, so each one is walked from the page's
 * cursor and only as far as one page can use; later pages continue the walk.
 * `total` therefore counts at most a page of runs per schedule.
 */
export const readSokoBot: CalendarReader = async (ctx) => {
  const { workspaceId, userId, query, options } = ctx;
  const schedules = await prisma.sokoBotSchedule.findMany({
    where: {
      workspaceId,
      systemKey: null,
      taskId: null,
      jobId: null,
      sokoBot: visibleBotWhere(userId, workspaceId, options),
    },
    select: {
      id: true,
      name: true,
      enabled: true,
      timezone: true,
      cronExpression: true,
      runOnce: true,
      nextRunAt: true,
      sokoBot: {
        select: {
          id: true,
          name: true,
          userId: true,
          projectId: true,
          versionId: true,
          status: true,
          proactivePaused: true,
          project: { select: { name: true } },
        },
      },
    },
  });
  if (schedules.length === 0) return { items: [], total: 0 };

  const from = query.cursor
    ? new Date(
        Math.max(query.from.getTime(), Date.parse(query.cursor.scheduledAt)),
      )
    : query.from;
  const now = new Date();
  const killSwitch = getEnv().SOKO_BOT_PROACTIVE_PAUSED;
  const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  // A page holds at most `limit` entries after the cursor, plus every
  // schedule's entry at the cursor's own time.
  const pastRuns = await prisma.sokoBotScheduleRun.findMany({
    where: {
      scheduleId: { in: [...byId.keys()] },
      scheduledFor: { gte: from, lt: query.to },
    },
    orderBy: [{ scheduledFor: "asc" }, { scheduleId: "asc" }],
    take: query.limit + 1 + schedules.length,
    select: { scheduleId: true, scheduledFor: true, status: true },
  });

  function entry(
    schedule: (typeof schedules)[number],
    at: Date,
    runState: "upcoming" | "running" | "done" | "failed",
  ): CalendarEntry {
    const bot = schedule.sokoBot;
    const shared = bot.userId === null;
    const cuso =
      bot.projectId !== null &&
      bot.versionId !== null &&
      CMO_SOKO_BOT_VERSION_IDS.includes(bot.versionId);
    return sokoBotRunCalendarItemSchema.parse({
      kind: "sokoBotRun",
      id: `sokobot:${schedule.id}:${at.toISOString()}`,
      scheduledAt: at.toISOString(),
      scheduleId: schedule.id,
      name: schedule.name,
      sokoBotId: bot.id,
      botName: bot.name,
      shared,
      projectName: bot.project?.name ?? null,
      runState,
      canChange:
        runState === "upcoming" &&
        !cuso &&
        at.getTime() === schedule.nextRunAt.getTime() &&
        at > now,
      ...calendarEntrySource({ workspaceId, projectId: bot.projectId }),
    });
  }

  const upcoming = killSwitch
    ? []
    : schedules
        .filter(
          (schedule) =>
            schedule.enabled &&
            schedule.nextRunAt < query.to &&
            schedule.sokoBot.status !== "PAUSED" &&
            !schedule.sokoBot.proactivePaused,
        )
        .flatMap((schedule) =>
          // The walk includes the cursor's own run, which the page then drops;
          // one more than a page beyond it tells whether another page follows.
          runTimes(schedule, from, query.to, query.limit + 2).map((at) =>
            entry(schedule, at, "upcoming"),
          ),
        );
  const past = pastRuns.flatMap((run) => {
    const schedule = byId.get(run.scheduleId);
    return schedule
      ? [entry(schedule, run.scheduledFor, RUN_STATE[run.status])]
      : [];
  });
  return pageInMemory([...past, ...upcoming], ctx);
};

/**
 * The schedule's first `max` run times in [from, to), as the scheduler fires
 * them: `nextRunAt` itself, even when moved off the cron, then the cron on
 * from there.
 */
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
  const times: Date[] = [];
  let next: Date | null = schedule.nextRunAt;
  while (next && next < to && times.length < max) {
    if (next >= from) times.push(next);
    if (schedule.runOnce) break;
    next = computeNextRun({
      cron: schedule.cronExpression,
      timezone: schedule.timezone,
      // cron's next is strictly after its start, so jump close to `from`.
      from: next < from ? new Date(from.getTime() - 1) : next,
    });
  }
  return times;
}
