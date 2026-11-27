import type { Prisma } from "@sokosumi/database";
import {
  redactSokoBotSensitiveText,
  sokoBotListSchedulesInputSchema,
} from "@sokosumi/soko-bot";
import { visibleSokoBotWhere } from "@/helpers/visible-soko-bots";
import prisma from "@/lib/db/prisma";
import {
  buildSchedulesTargetResolution,
  isTargetResolverEnabled,
} from "@/lib/soko-bot/target-resolver";
import {
  canWriteTaskSchedule,
  SCHEDULE_ASSIGNEE_VENDOR,
  taskScheduleVisibilityWhere,
} from "@/services/task-schedule-read.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { taskScheduleAccess } from "./task-schedule-access";

/**
 * `list_schedules`: who made each schedule, which bot runs it and how its
 * last run went. The workspace scope shows what the member sees on the
 * Schedules page and the calendar: Task Schedules they may read and the
 * schedules of the bots they reach. A bot changes only its own; the rest it
 * proposes (ADR 0057 keeps the Requester).
 */

/** Per kind: enough for "which are outdated", short enough for a turn. */
const LIMIT = 40;
const TEXT_CHARS = 200;

function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = redactSokoBotSensitiveText(value).replaceAll(/\s+/g, " ").trim();
  return text.length > TEXT_CHARS ? `${text.slice(0, TEXT_CHARS)}…` : text;
}

const words = (query: string | undefined) =>
  (query ?? "").split(/\s+/).filter((word) => word.length >= 2);

const contains = (word: string) => ({
  contains: word,
  mode: "insensitive" as const,
});

async function botSchedules(
  authorized: AuthorizedSokoBotRuntime,
  where: Prisma.SokoBotScheduleWhereInput,
  query: string | undefined,
) {
  const { sokoBotId, actingUserId } = authorized.turn;
  const rows = await prisma.sokoBotSchedule.findMany({
    where: {
      AND: [
        where,
        // A one-time schedule that already ran is history, not a follow-up.
        { NOT: { runOnce: true, enabled: false, lastRunAt: { not: null } } },
        ...words(query).map((word) => ({
          OR: [{ name: contains(word) }, { prompt: contains(word) }],
        })),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LIMIT + 1,
    select: {
      id: true,
      name: true,
      enabled: true,
      timezone: true,
      cronExpression: true,
      runOnce: true,
      prompt: true,
      systemKey: true,
      createdAt: true,
      nextRunAt: true,
      lastRunAt: true,
      consecutiveFailures: true,
      taskId: true,
      jobId: true,
      sokoBotId: true,
      requestedByUserId: true,
      requestedBy: { select: { name: true } },
      sokoBot: { select: { name: true } },
      runs: {
        where: { status: { in: ["COMPLETED", "FAILED", "DEAD_LETTER"] } },
        orderBy: { scheduledFor: "desc" },
        take: 1,
        select: { status: true, errorKind: true },
      },
    },
  });
  return {
    more: rows.length > LIMIT,
    schedules: rows.slice(0, LIMIT).map((row) => {
      const own = row.sokoBotId === sokoBotId;
      return {
        kind: "bot",
        id: row.id,
        name: row.name,
        runsOn: own ? "you" : row.sokoBot.name,
        createdBy: row.systemKey
          ? "built-in rhythm"
          : (row.requestedBy?.name ??
            (row.requestedByUserId ? "a former member" : "the bot itself")),
        ...(own &&
        row.requestedByUserId &&
        actingUserId &&
        row.requestedByUserId !== actingUserId
          ? { createdBySomeoneElse: true }
          : {}),
        createdAt: row.createdAt.toISOString(),
        enabled: row.enabled,
        when: row.runOnce ? "once" : row.cronExpression,
        timezone: row.timezone,
        nextRunAt: row.enabled ? row.nextRunAt.toISOString() : null,
        lastRunAt: row.lastRunAt?.toISOString() ?? null,
        lastResult: row.runs[0]
          ? row.runs[0].status === "COMPLETED"
            ? "done"
            : `failed${row.runs[0].errorKind ? ` (${row.runs[0].errorKind})` : ""}`
          : null,
        ...(row.consecutiveFailures
          ? { failuresInARow: row.consecutiveFailures }
          : {}),
        ...(row.taskId ? { watchesTaskId: row.taskId } : {}),
        ...(row.jobId ? { watchesJobId: row.jobId } : {}),
        prompt: clip(row.prompt),
        youCanChange: own,
      };
    }),
  };
}

async function taskSchedules(
  authorized: AuthorizedSokoBotRuntime,
  userId: string,
  workspaceId: string,
  query?: string,
) {
  const reader = { kind: "user" as const, userId };
  const rows = await prisma.taskSchedule.findMany({
    where: {
      AND: [
        { workspaceId, ...taskScheduleVisibilityWhere(reader) },
        ...words(query).map((word) => ({
          OR: [{ name: contains(word) }, { description: contains(word) }],
        })),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LIMIT + 1,
    include: {
      ...SCHEDULE_ASSIGNEE_VENDOR,
      assignee: { select: { vendorId: true, name: true } },
      owner: { select: { name: true } },
      project: { select: { name: true } },
      assigneeUser: { select: { name: true } },
      assigneeSokoBot: { select: { name: true } },
      runs: {
        where: { effectiveScheduledAt: { lte: new Date() } },
        orderBy: { effectiveScheduledAt: "desc" },
        take: 1,
        select: {
          effectiveScheduledAt: true,
          state: true,
          releasedTask: { select: { status: true } },
        },
      },
    },
  });
  return {
    more: rows.length > LIMIT,
    schedules: rows.slice(0, LIMIT).map((row) => ({
      kind: "task",
      id: row.id,
      name: row.name,
      runsOn:
        row.assignee?.name ??
        row.assigneeSokoBot?.name ??
        row.assigneeUser?.name ??
        "unassigned",
      createdBy:
        row.creatorUser?.name ??
        (row.creatorSokoBot
          ? `${row.creatorSokoBot.name}${row.creatorSokoBot.user?.name ? ` (${row.creatorSokoBot.user.name}'s assistant)` : ""}`
          : (row.creatorCoworker?.name ?? "unknown")),
      owner: row.owner?.name ?? null,
      project: row.project?.name ?? null,
      createdAt: row.createdAt.toISOString(),
      state: row.state,
      when: row.expr,
      timezone: row.timezone,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      lastRunAt: row.runs[0]?.effectiveScheduledAt.toISOString() ?? null,
      lastResult: row.runs[0]
        ? (row.runs[0].releasedTask?.status ?? row.runs[0].state)
        : null,
      description: clip(row.description),
      // The same rule save_task_schedule and delete_task_schedule apply.
      ...taskScheduleAccess(authorized, row, canWriteTaskSchedule(reader, row)),
    })),
  };
}

export async function listSchedules(
  authorized: AuthorizedSokoBotRuntime,
  raw: unknown,
): Promise<unknown> {
  const parsed = sokoBotListSchedulesInputSchema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new SokoBotRuntimeValidationError(
      'list_schedules takes scope ("mine" or "workspace") and query, both optional.',
    );
  const { scope = "mine", query } = parsed.data;
  const { sokoBotId, workspaceId, actingUserId } = authorized.turn;
  const targetResolver = isTargetResolverEnabled(authorized.turn.versionId);
  if (scope === "mine") {
    const mine = await botSchedules(authorized, { sokoBotId }, query);
    return targetResolver
      ? {
          ...mine,
          targetResolution: buildSchedulesTargetResolution({
            botSchedules: mine.schedules,
          }),
        }
      : mine;
  }
  // The workspace is the member's view: only for the member's own turn.
  if (!actingUserId || (authorized.askedByKind ?? "OWNER") !== "OWNER")
    throw new SokoBotRuntimeValidationError(
      "The workspace's schedules are read only on your owner's own turn; list yours with scope mine.",
    );
  const [bots, tasks] = await Promise.all([
    botSchedules(
      authorized,
      {
        workspaceId,
        OR: [
          { sokoBotId },
          // Other bots: what the member set up, not their built-in rhythms
          // or the follow-ups that watch one Task.
          {
            systemKey: null,
            taskId: null,
            jobId: null,
            sokoBot: visibleSokoBotWhere(actingUserId, workspaceId),
          },
        ],
      },
      query,
    ),
    taskSchedules(authorized, actingUserId, workspaceId, query),
  ]);
  return {
    botSchedules: bots.schedules,
    taskSchedules: tasks.schedules,
    ...(bots.more || tasks.more
      ? { more: "Only the first 40 of a kind: narrow with query." }
      : {}),
    ...(targetResolver
      ? {
          targetResolution: buildSchedulesTargetResolution({
            botSchedules: bots.schedules,
            taskSchedules: tasks.schedules,
          }),
        }
      : {}),
  };
}
