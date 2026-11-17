import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma, TaskStatus } from "@sokosumi/database";
import { formatTaskIdentifier } from "@sokosumi/utils";

import { createNotification } from "@/helpers/notifications";
import {
  isOverdueMomentDue,
  TASK_INTEREST_FALLBACK_TIMEZONE,
} from "@/helpers/task-interest-clock";
import { taskNotificationPayload } from "@/helpers/task-notifications";
import { isFollowingSokoBot } from "@/helpers/task-participant-rows";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import { isPrivateTaskVisibleToHuman } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { linkText } from "@/lib/soko-bot/action-response-targets";

/**
 * How far back each tick looks for moments. The ledger, not a cursor, makes
 * each delivery happen once, so a send that failed is tried again on the
 * next tick for as long as its moment is inside this window.
 */
const LOOKBACK_MS = 48 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** Moments delivered per tick; the rest wait for the next one. */
const MOMENT_BATCH = 200;
/** Upper bound on rows one scan reads, delivered or not. */
const SCAN_CAP = 5_000;
const PARTICIPANT_TASK_CHUNK = 500;
/** The overdue sweep runs once per this many minutes, not every tick. */
const OVERDUE_SWEEP_MINUTES = 15;

const STATUS_MOMENTS = {
  [TaskStatus.COMPLETED]: "completed",
  [TaskStatus.FAILED]: "failed",
  [TaskStatus.CANCELED]: "canceled",
} as const;

type MomentKind =
  | (typeof STATUS_MOMENTS)[keyof typeof STATUS_MOMENTS]
  | "overdue"
  | "dueDateMovedLater";

const MESSAGE_KEYS: Record<MomentKind, string> = {
  completed: "Notifications.Task.completed",
  failed: "Notifications.Task.failed",
  canceled: "Notifications.Task.canceled",
  overdue: "Notifications.Task.overdue",
  dueDateMovedLater: "Notifications.Task.dueDateMovedLater",
};

export const TASK_MOMENT_CHANNEL = {
  sokoBot: "SOKO_BOT",
  bell: "BELL",
  /** Recorded for a participant the moment skips, so it is decided once. */
  none: "NONE",
} as const;

export interface TaskMoment {
  kind: MomentKind;
  taskId: string;
  /** Ledger key: one delivery per person and key. */
  key: string;
  /**
   * The Notification row's event id. A status moment uses its Task event, so
   * an Owner who also follows as a plain participant gets the one row the
   * status dispatch writes, not two.
   */
  eventId: string;
  /** When it happened. Null for overdue, which reaches anyone following. */
  at: Date | null;
  actorUserId: string | null;
  writerName?: string | null;
  from?: Date;
  to?: Date;
  dueOn?: Date;
}

export interface TaskInterestSyncResult {
  moments: number;
  sent: number;
  failed: number;
}

const MOMENT_TASK_SELECT = {
  id: true,
  name: true,
  status: true,
  dueOn: true,
  archivedAt: true,
  visibility: true,
  ownerId: true,
  workspaceId: true,
  projectId: true,
  number: true,
  project: { select: { name: true, identifier: true } },
  workspace: { select: { userId: true, organizationId: true } },
  assignee: { select: { name: true } },
  assigneeSokoBot: { select: { name: true } },
  participants: {
    select: { userId: true, subscribedAt: true, createdAt: true },
  },
} as const satisfies Prisma.TaskSelect;

type MomentTask = Prisma.TaskGetPayload<{ select: typeof MOMENT_TASK_SELECT }>;

const day = (date: Date) => date.toISOString().slice(0, 10);

/** Tasks with participants that changed inside the window. */
async function participantTaskIds(since: Date): Promise<string[]> {
  const rows = await prisma.taskParticipant.findMany({
    distinct: ["taskId"],
    where: { task: { archivedAt: null, updatedAt: { gte: since } } },
    select: { taskId: true },
  });
  return rows.map((row) => row.taskId);
}

async function statusMoments(
  taskIds: readonly string[],
  since: Date,
): Promise<TaskMoment[]> {
  const moments: TaskMoment[] = [];
  for (let i = 0; i < taskIds.length; i += PARTICIPANT_TASK_CHUNK) {
    const events = await prisma.taskEvent.findMany({
      where: {
        taskId: { in: taskIds.slice(i, i + PARTICIPANT_TASK_CHUNK) },
        createdAt: { gte: since },
        status: {
          in: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED],
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: SCAN_CAP,
      select: {
        id: true,
        taskId: true,
        status: true,
        userId: true,
        createdAt: true,
        user: { select: { name: true } },
        coworker: { select: { name: true } },
        sokoBot: { select: { name: true } },
      },
    });
    for (const event of events) {
      const kind =
        STATUS_MOMENTS[event.status as keyof typeof STATUS_MOMENTS] ?? null;
      if (!kind) continue;
      moments.push({
        kind,
        taskId: event.taskId,
        key: `status:${event.id}`,
        eventId: event.id,
        at: event.createdAt,
        actorUserId: event.userId,
        writerName:
          event.sokoBot?.name ?? event.coworker?.name ?? event.user?.name,
      });
    }
  }
  return moments;
}

async function dueDateMovedLaterMoments(since: Date): Promise<TaskMoment[]> {
  const changes = await prisma.taskDueDateChange.findMany({
    where: {
      createdAt: { gte: since },
      task: { archivedAt: null, participants: { some: {} } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: SCAN_CAP,
  });
  return changes.map((change) => ({
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
async function overdueMoments(now: Date): Promise<TaskMoment[]> {
  const today = new Date(`${day(now)}T00:00:00.000Z`);
  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      dueOn: { gte: new Date(today.getTime() - 2 * DAY_MS), lte: today },
      status: { notIn: [...SETTLED_TASK_STATUSES] },
      participants: { some: {} },
    },
    orderBy: { id: "asc" },
    take: SCAN_CAP,
    select: { id: true, dueOn: true },
  });
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
          },
        ]
      : [],
  );
}

/** The moment still holds for the Task as it is now. */
function momentStillHolds(moment: TaskMoment, task: MomentTask): boolean {
  if (task.archivedAt) return false;
  if (moment.kind === "overdue") {
    return (
      task.dueOn?.getTime() === moment.dueOn?.getTime() &&
      !(SETTLED_TASK_STATUSES as readonly TaskStatus[]).includes(task.status)
    );
  }
  if (moment.kind === "dueDateMovedLater") {
    // Moved back since: the later date it announced no longer stands.
    return (
      task.dueOn !== null &&
      moment.to !== undefined &&
      task.dueOn.getTime() >= moment.to.getTime()
    );
  }
  return true;
}

/**
 * Participants the moment reaches: not its actor, still a workspace member,
 * able to see the Task, and on the Task before the moment happened.
 */
async function reachedParticipants(moment: TaskMoment, task: MomentTask) {
  const candidates = task.participants.filter(
    (participant) =>
      participant.userId !== moment.actorUserId &&
      isPrivateTaskVisibleToHuman(task, participant.userId) &&
      (moment.at === null || participant.createdAt <= moment.at),
  );
  if (candidates.length === 0) return [];
  const { organizationId, userId: personalUserId } = task.workspace;
  if (!organizationId) {
    return candidates.filter((c) => c.userId === personalUserId);
  }
  const members = await prisma.member.findMany({
    where: {
      organizationId,
      userId: { in: candidates.map((c) => c.userId) },
    },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((member) => member.userId));
  return candidates.filter((c) => memberIds.has(c.userId));
}

function taskLabel(task: MomentTask): string {
  const identifier = formatTaskIdentifier(
    task.project?.identifier,
    task.number,
  );
  const link = `[${linkText(task.name)}](/tasks/${encodeURIComponent(task.id)})`;
  return identifier ? `${link} (${identifier})` : link;
}

const STATUS_LABEL: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.RUNNING]: "running",
  [TaskStatus.READY]: "ready",
  [TaskStatus.QUEUED]: "queued",
  [TaskStatus.DRAFT]: "a draft",
};

/** The fixed text a follower's Soko Bot posts. No model call. */
export function taskMomentNotice(moment: TaskMoment, task: MomentTask): string {
  const label = taskLabel(task);
  switch (moment.kind) {
    case "completed":
      return `${label} is completed.`;
    case "failed":
      return `${label} failed.`;
    case "canceled":
      return `${label} was canceled.`;
    case "overdue":
      return `${label} passed its due date, ${moment.dueOn ? day(moment.dueOn) : ""}. It is still ${STATUS_LABEL[task.status] ?? task.status.toLowerCase().replaceAll("_", " ")}.`;
    case "dueDateMovedLater":
      return `The due date of ${label} moved from ${moment.from ? day(moment.from) : "?"} to ${moment.to ? day(moment.to) : "?"}.`;
  }
}

async function sendBell(
  moment: TaskMoment,
  task: MomentTask,
  userId: string,
): Promise<void> {
  const writesName = moment.kind === "completed" || moment.kind === "failed";
  const { messageParams, metadata } = taskNotificationPayload({
    ...task,
    ...(writesName
      ? {
          extraMessageParams: {
            coworkerName:
              moment.writerName?.trim() ||
              task.assigneeSokoBot?.name?.trim() ||
              task.assignee?.name ||
              "Assistant",
          },
        }
      : {}),
  });
  await createNotification({
    userId,
    kind: NotificationKind.TASK,
    referenceId: task.id,
    eventId: moment.eventId,
    messageKey: MESSAGE_KEYS[moment.kind],
    messageParams,
    metadata,
    workspaceId: task.workspaceId,
  });
}

/** Post the notice; false when the bot is gone and the bell must take it. */
async function sendSokoBotNotice(
  moment: TaskMoment,
  task: MomentTask,
  userId: string,
  sokoBotId: string,
): Promise<boolean> {
  const { postSokoBotOwnerNotice } = await import(
    "@/services/soko-bot-chat.service"
  );
  const posted = await postSokoBotOwnerNotice({
    sokoBotId,
    content: taskMomentNotice(moment, task),
    key: `task-interest:${moment.key}:${userId}`,
    osBannerDefaultOn: true,
  });
  return posted !== null;
}

async function deliverMoment(
  moment: TaskMoment,
  now: Date,
  result: TaskInterestSyncResult,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: moment.taskId },
    select: MOMENT_TASK_SELECT,
  });
  if (!task) return;

  const delivered = await prisma.taskMomentDelivery.findMany({
    where: { taskId: task.id, momentKey: moment.key },
    select: { userId: true },
  });
  const decided = new Set(delivered.map((row) => row.userId));
  const open = task.participants.filter((p) => !decided.has(p.userId));
  if (open.length === 0) return;

  const reached = momentStillHolds(moment, task)
    ? await reachedParticipants(moment, task)
    : [];
  const reachedIds = new Set(reached.map((r) => r.userId));
  const skipped = open.filter((p) => !reachedIds.has(p.userId));
  if (skipped.length > 0 && moment.kind !== "overdue") {
    await prisma.taskMomentDelivery.createMany({
      data: skipped.map((p) => ({
        userId: p.userId,
        taskId: task.id,
        momentKey: moment.key,
        channel: TASK_MOMENT_CHANNEL.none,
      })),
      skipDuplicates: true,
    });
  }

  const recipients = reached.filter((r) => !decided.has(r.userId));
  if (recipients.length === 0) return;
  const bots = await prisma.sokoBot.findMany({
    where: {
      userId: { in: recipients.map((r) => r.userId) },
      projectId: null,
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      ingestTimezone: true,
      projectId: true,
      archivedAt: true,
      deletedAt: true,
      proactivePaused: true,
      adminPausedAt: true,
    },
  });

  for (const recipient of recipients) {
    const own = bots.filter((bot) => bot.userId === recipient.userId);
    const inWorkspace = own.find((bot) => bot.workspaceId === task.workspaceId);

    if (moment.kind === "overdue" && moment.dueOn) {
      const timeZone =
        inWorkspace?.ingestTimezone ??
        own[0]?.ingestTimezone ??
        TASK_INTEREST_FALLBACK_TIMEZONE;
      if (!isOverdueMomentDue(moment.dueOn, now, timeZone)) continue;
    }

    const followingBot =
      recipient.subscribedAt !== null &&
      inWorkspace &&
      isFollowingSokoBot(inWorkspace)
        ? inWorkspace
        : null;
    const channel = followingBot
      ? TASK_MOMENT_CHANNEL.sokoBot
      : TASK_MOMENT_CHANNEL.bell;

    // Claim first: a concurrent tick that lost the claim sends nothing.
    const { count } = await prisma.taskMomentDelivery.createMany({
      data: [
        {
          userId: recipient.userId,
          taskId: task.id,
          momentKey: moment.key,
          channel,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) continue;

    try {
      const botPosted = followingBot
        ? await sendSokoBotNotice(
            moment,
            task,
            recipient.userId,
            followingBot.id,
          )
        : false;
      if (!botPosted) {
        if (followingBot) {
          // The bot went away between the read and the post.
          await prisma.taskMomentDelivery.updateMany({
            where: { userId: recipient.userId, momentKey: moment.key },
            data: { channel: TASK_MOMENT_CHANNEL.bell },
          });
        }
        await sendBell(moment, task, recipient.userId);
      }
      result.sent += 1;
    } catch (error) {
      // Release the claim so the next tick tries again.
      await prisma.taskMomentDelivery.deleteMany({
        where: { userId: recipient.userId, momentKey: moment.key },
      });
      result.failed += 1;
      Sentry.captureException(error, {
        extra: {
          taskId: task.id,
          userId: recipient.userId,
          momentKey: moment.key,
          notificationType: "task-interest-moment",
        },
      });
    }
  }
}

/**
 * Moments some participant has no ledger row for yet. Cheap enough to run
 * every tick: one count per Task and one grouped count per key.
 */
async function openMoments(moments: TaskMoment[]): Promise<TaskMoment[]> {
  if (moments.length === 0) return [];
  const [participants, ledger] = await Promise.all([
    prisma.taskParticipant.groupBy({
      by: ["taskId"],
      where: { taskId: { in: [...new Set(moments.map((m) => m.taskId))] } },
      _count: { _all: true },
    }),
    prisma.taskMomentDelivery.groupBy({
      by: ["momentKey"],
      where: { momentKey: { in: moments.map((m) => m.key) } },
      _count: { _all: true },
    }),
  ]);
  const participantCount = new Map(
    participants.map((row) => [row.taskId, row._count._all]),
  );
  const ledgerCount = new Map(
    ledger.map((row) => [row.momentKey, row._count._all]),
  );
  return moments.filter(
    (moment) =>
      (ledgerCount.get(moment.key) ?? 0) <
      (participantCount.get(moment.taskId) ?? 0),
  );
}

/**
 * Tell Task participants about the five moments they follow: completed,
 * failed, canceled, overdue and due date moved later. A subscribed
 * participant whose personal Soko Bot is live hears it from the bot; every
 * other participant gets a bell Notification. The channel is chosen at send
 * time, and membership and visibility are checked again then.
 */
export async function syncTaskInterest(input: {
  shouldContinue: () => boolean;
  now?: Date;
}): Promise<TaskInterestSyncResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const result: TaskInterestSyncResult = { moments: 0, sent: 0, failed: 0 };

  const moments = await openMoments([
    ...(await statusMoments(await participantTaskIds(since), since)),
    ...(await dueDateMovedLaterMoments(since)),
    ...(now.getUTCMinutes() % OVERDUE_SWEEP_MINUTES === 0
      ? await overdueMoments(now)
      : []),
  ]);

  for (const moment of moments.slice(0, MOMENT_BATCH)) {
    if (!input.shouldContinue()) break;
    result.moments += 1;
    try {
      await deliverMoment(moment, now, result);
    } catch (error) {
      result.failed += 1;
      Sentry.captureException(error, {
        extra: {
          taskId: moment.taskId,
          momentKey: moment.key,
          notificationType: "task-interest-moment",
        },
      });
    }
  }
  return result;
}
