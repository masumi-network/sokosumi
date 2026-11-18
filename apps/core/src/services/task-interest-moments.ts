import { type Prisma, TaskStatus } from "@sokosumi/database";

import {
  isOverdueMomentDue,
  TASK_INTEREST_FALLBACK_TIMEZONE,
} from "@/helpers/task-interest-clock";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import prisma from "@/lib/db/prisma";
import { tryUseLogger } from "@/lib/evlog";

/*
 * Finding Task interest moments: what happened, and who has not been told
 * yet. Delivery decides the channel and sends.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Upper bound on rows one scan reads, delivered or not. */
const SCAN_CAP = 5_000;
/** Deferred summaries tried again per tick, outside the lookback window. */
const DEFERRED_BATCH = 20;

/** A full scan leaves older rows unread until the window moves: say so. */
function warnIfCapped(rows: readonly unknown[], scan: string) {
  if (rows.length === SCAN_CAP)
    tryUseLogger()?.warn("Task interest scan cap reached; older moments wait", {
      taskInterest: { scan, cap: SCAN_CAP },
    });
}

export const STATUS_MOMENTS = {
  [TaskStatus.COMPLETED]: "completed",
  [TaskStatus.FAILED]: "failed",
  [TaskStatus.CANCELED]: "canceled",
} as const;

export type MomentKind =
  | (typeof STATUS_MOMENTS)[keyof typeof STATUS_MOMENTS]
  | "overdue"
  | "dueDateMovedLater";

export const TASK_MOMENT_CHANNEL = {
  sokoBot: "SOKO_BOT",
  bell: "BELL",
  /** Recorded for a person the moment skips, so it is decided once. */
  none: "NONE",
  /** A summary the bot could not start yet; tried again from `retryAt`. */
  deferred: "DEFERRED",
} as const;

export interface TaskMoment {
  kind: MomentKind;
  taskId: string;
  /** Ledger key: one delivery per person and key. */
  key: string;
  /**
   * The Notification row's event id. A status moment uses its Task event, so
   * an Owner who is also a participant gets the one row the
   * status dispatch writes, not two.
   */
  eventId: string;
  /** When it happened. Null for overdue, which reaches anyone following. */
  at: Date | null;
  actorUserId: string | null;
  /** The Soko Bot that wrote a status event, if one did. */
  actorSokoBotId?: string | null;
  writerName?: string | null;
  from?: Date;
  to?: Date;
  dueOn?: Date;
  /** Overdue only: the Task's workspace, which picks each person's clock. */
  workspaceId?: string;
}

export const day = (date: Date) => date.toISOString().slice(0, 10);

/** A person's own Soko Bots, which give them a timezone and a channel. */
export const PERSONAL_BOT_WHERE = {
  projectId: null,
  deletedAt: null,
} as const satisfies Prisma.SokoBotWhereInput;

/**
 * The clock overdue is read on: the person's bot in the Task's workspace,
 * else any of their personal bots, else the fallback.
 */
export function interestTimeZone(
  bots: readonly {
    userId: string | null;
    workspaceId: string;
    ingestTimezone: string;
  }[],
  userId: string,
  workspaceId: string,
): string {
  const own = bots.filter((bot) => bot.userId === userId);
  return (
    (own.find((bot) => bot.workspaceId === workspaceId) ?? own[0])
      ?.ingestTimezone ?? TASK_INTEREST_FALLBACK_TIMEZONE
  );
}

const STATUS_EVENT_SELECT = {
  id: true,
  taskId: true,
  status: true,
  userId: true,
  sokoBotId: true,
  createdAt: true,
  user: { select: { name: true } },
  coworker: { select: { name: true } },
  sokoBot: { select: { name: true } },
} as const satisfies Prisma.TaskEventSelect;

function statusMoment(
  event: Prisma.TaskEventGetPayload<{ select: typeof STATUS_EVENT_SELECT }>,
): TaskMoment[] {
  const kind =
    STATUS_MOMENTS[event.status as keyof typeof STATUS_MOMENTS] ?? null;
  if (!kind) return [];
  return [
    {
      kind,
      taskId: event.taskId,
      key: `status:${event.id}`,
      eventId: event.id,
      at: event.createdAt,
      actorUserId: event.userId,
      actorSokoBotId: event.sokoBotId,
      writerName:
        event.sokoBot?.name ?? event.coworker?.name ?? event.user?.name,
    },
  ];
}

/** A Task someone hears from: it has a participant or a follower. */
const HAS_AUDIENCE = {
  OR: [{ participants: { some: {} } }, { followers: { some: {} } }],
} satisfies Prisma.TaskWhereInput;

/**
 * Completed, failed and canceled events on Tasks with participants or
 * followers. Newest
 * first: past the cap, old moments wait, never new ones.
 */
export async function statusMoments(since: Date): Promise<TaskMoment[]> {
  const events = await prisma.taskEvent.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: [...SETTLED_TASK_STATUSES] },
      task: { archivedAt: null, ...HAS_AUDIENCE },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SCAN_CAP,
    select: STATUS_EVENT_SELECT,
  });
  warnIfCapped(events, "status");
  return events.flatMap(statusMoment);
}

/** Deferred summaries due again, whenever their moment happened. */
export async function deferredMoments(now: Date): Promise<TaskMoment[]> {
  const rows = await prisma.taskMomentDelivery.findMany({
    where: {
      channel: TASK_MOMENT_CHANNEL.deferred,
      retryAt: { lte: now },
    },
    orderBy: { retryAt: "asc" },
    take: DEFERRED_BATCH,
    select: { momentKey: true },
  });
  const eventIds = [
    ...new Set(
      rows.flatMap(({ momentKey }) =>
        momentKey.startsWith("status:") ? [momentKey.slice(7)] : [],
      ),
    ),
  ];
  if (eventIds.length === 0) return [];
  const events = await prisma.taskEvent.findMany({
    where: { id: { in: eventIds } },
    select: STATUS_EVENT_SELECT,
  });
  return events.flatMap(statusMoment);
}

export async function dueDateMovedLaterMoments(
  since: Date,
): Promise<TaskMoment[]> {
  const changes = await prisma.taskDueDateChange.findMany({
    where: {
      createdAt: { gte: since },
      task: { archivedAt: null, ...HAS_AUDIENCE },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SCAN_CAP,
  });
  warnIfCapped(changes, "dueDateMovedLater");
  // A Task moved twice: only its latest move, the first one read, is news.
  const latest = new Map<string, string>();
  for (const change of changes) {
    if (!latest.has(change.taskId)) latest.set(change.taskId, change.id);
  }
  return changes
    .filter((change) => latest.get(change.taskId) === change.id)
    .map((change) => ({
      kind: "dueDateMovedLater",
      taskId: change.taskId,
      key: `due-later:${change.id}`,
      eventId: change.id,
      at: change.createdAt,
      actorUserId: change.actorUserId,
      from: change.fromDueOn,
      to: change.toDueOn,
    }));
}

/**
 * Tasks whose first day after the due date can be today somewhere: due one
 * or two days before today (UTC), or today itself for zones ahead of UTC.
 */
export async function overdueMoments(now: Date): Promise<TaskMoment[]> {
  const today = new Date(`${day(now)}T00:00:00.000Z`);
  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      dueOn: { gte: new Date(today.getTime() - 2 * DAY_MS), lte: today },
      status: { notIn: [...SETTLED_TASK_STATUSES] },
      ...HAS_AUDIENCE,
    },
    orderBy: { id: "asc" },
    take: SCAN_CAP,
    select: { id: true, dueOn: true, workspaceId: true },
  });
  warnIfCapped(tasks, "overdue");
  return tasks.flatMap((task) =>
    task.dueOn
      ? [
          {
            kind: "overdue" as const,
            taskId: task.id,
            key: `overdue:${task.id}:${day(task.dueOn)}`,
            eventId: `overdue:${day(task.dueOn)}`,
            at: null,
            actorUserId: null,
            dueOn: task.dueOn,
            workspaceId: task.workspaceId,
          },
        ]
      : [],
  );
}

interface OpenMoment {
  moment: TaskMoment;
  /** Current participants and followers with no ledger row for it yet. */
  openUserIds: string[];
}

/**
 * Moments a current participant or follower has no ledger row for yet. A
 * row of someone who left does not count, so their leaving closes nothing
 * for the others.
 */
export async function openMoments(
  moments: TaskMoment[],
): Promise<OpenMoment[]> {
  if (moments.length === 0) return [];
  const taskIds = [...new Set(moments.map((m) => m.taskId))];
  const [participants, followers, ledger] = await Promise.all([
    prisma.taskParticipant.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, userId: true },
    }),
    prisma.taskFollower.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, userId: true },
    }),
    prisma.taskMomentDelivery.findMany({
      where: { momentKey: { in: moments.map((m) => m.key) } },
      select: { momentKey: true, userId: true },
    }),
  ]);
  const audienceOf = new Map<string, Set<string>>();
  for (const { taskId, userId } of [...participants, ...followers]) {
    audienceOf.set(taskId, (audienceOf.get(taskId) ?? new Set()).add(userId));
  }
  const recorded = new Set(
    ledger.map((row) => `${row.momentKey}\u0000${row.userId}`),
  );
  return moments.flatMap((moment) => {
    const openUserIds = [...(audienceOf.get(moment.taskId) ?? [])].filter(
      (userId) => !recorded.has(`${moment.key}\u0000${userId}`),
    );
    return openUserIds.length > 0 ? [{ moment, openUserIds }] : [];
  });
}

/**
 * Drops overdue moments no open person's morning has reached yet, so
 * they do not take batch places from moments that can be sent now.
 */
export async function dueNow(
  open: OpenMoment[],
  now: Date,
): Promise<TaskMoment[]> {
  const overdueUserIds = new Set(
    open.flatMap(({ moment, openUserIds }) =>
      moment.kind === "overdue" ? openUserIds : [],
    ),
  );
  const bots =
    overdueUserIds.size === 0
      ? []
      : await prisma.sokoBot.findMany({
          where: { userId: { in: [...overdueUserIds] }, ...PERSONAL_BOT_WHERE },
          select: { userId: true, workspaceId: true, ingestTimezone: true },
        });
  return open
    .filter(({ moment, openUserIds }) => {
      if (moment.kind !== "overdue") return true;
      const { dueOn, workspaceId } = moment;
      return (
        dueOn !== undefined &&
        workspaceId !== undefined &&
        openUserIds.some((userId) =>
          isOverdueMomentDue(
            dueOn,
            now,
            interestTimeZone(bots, userId, workspaceId),
          ),
        )
      );
    })
    .map(({ moment }) => moment);
}
