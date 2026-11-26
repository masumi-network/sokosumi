import type { SokoBotScheduleRunStatus } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";

import { getEnv } from "@/config/env";
import { visibleSokoBotWhere } from "@/helpers/visible-soko-bots";
import prisma from "@/lib/db/prisma";
import {
  type EffectiveRun,
  effectiveRuns,
} from "@/lib/soko-bot/schedule-run-changes";
import { sokoBotRunCalendarItemSchema } from "@/schemas/workspace-calendar.schema";
import { RUN_HORIZON_MS } from "@/services/task-schedule-runs.service";

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
 * Soko Bot schedule runs the member may see: the ones still to come, from
 * `nextRunAt` and the cron, and the ones that already ran, from their run
 * rows (kept for a week). Only schedules a member or the bot set up; built-in
 * rhythms and schedules that follow a Task or Job are housekeeping. Runs to
 * come leave out a bot the runner would skip: paused by an admin or the
 * runtime, by its owner, or by the platform kill switch.
 *
 * Runs still to come in the next 90 days, the Task Schedule planning window,
 * can be moved, skipped or restored (`canChange`); a recurring schedule's
 * moved and skipped runs come from its run changes, exactly as the scheduler
 * fires them. Cuso's schedules are CMO's and stay read-only, as on his
 * console.
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
      sokoBot: visibleSokoBotWhere(userId, workspaceId, options),
    },
    select: {
      id: true,
      name: true,
      enabled: true,
      timezone: true,
      cronExpression: true,
      runOnce: true,
      nextRunAt: true,
      runChanges: { select: { originalAt: true, scheduledAt: true } },
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
  const horizon = new Date(now.getTime() + RUN_HORIZON_MS);
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
    { at, originalAt }: EffectiveRun,
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
      originalAt: originalAt.toISOString(),
      canChange: runState === "upcoming" && !cuso && at > now && at <= horizon,
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
          runTimes(schedule, from, query.to, query.limit + 2).map((run) =>
            entry(schedule, run, "upcoming"),
          ),
        );
  const past = pastRuns.flatMap((run) => {
    const schedule = byId.get(run.scheduleId);
    return schedule
      ? [
          entry(
            schedule,
            // History keeps the time a run fired, not the cron time it had.
            { at: run.scheduledFor, originalAt: run.scheduledFor },
            RUN_STATE[run.status],
          ),
        ]
      : [];
  });
  return pageInMemory([...past, ...upcoming], ctx);
};

/**
 * The schedule's first `max` runs in [from, to), as the scheduler fires
 * them: `nextRunAt` itself, even when moved off the cron, then the runs after
 * it with their moves and skips. A one-time schedule runs at `nextRunAt` only.
 */
export function runTimes(
  schedule: {
    cronExpression: string;
    timezone: string;
    runOnce: boolean;
    nextRunAt: Date;
    runChanges: { originalAt: Date; scheduledAt: Date | null }[];
  },
  from: Date,
  to: Date,
  max: number,
): EffectiveRun[] {
  const first = schedule.nextRunAt;
  if (schedule.runOnce) {
    return first >= from && first < to
      ? [{ at: first, originalAt: first }]
      : [];
  }
  const after = new Date(Math.max(from.getTime(), first.getTime()) - 1);
  return effectiveRuns(schedule, schedule.runChanges, after, to, max);
}
