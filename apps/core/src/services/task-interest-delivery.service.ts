import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma, TaskStatus } from "@sokosumi/database";
import { formatTaskIdentifier } from "@sokosumi/utils";

import { createNotification } from "@/helpers/notifications";
import { isFollowingSokoBot } from "@/helpers/task-follower-rows";
import { isOverdueMomentDue } from "@/helpers/task-interest-clock";
import { taskNotificationPayload } from "@/helpers/task-notifications";
import { SETTLED_TASK_STATUSES } from "@/helpers/task-settled-statuses";
import { isPrivateTaskVisibleToHuman } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { linkText } from "@/lib/soko-bot/action-response-targets";
import {
  day,
  deferredMoments,
  dueDateMovedLaterMoments,
  dueNow,
  interestTimeZone,
  type MomentKind,
  openMoments,
  overdueMoments,
  PERSONAL_BOT_WHERE,
  STATUS_MOMENTS,
  statusMoments,
  TASK_MOMENT_CHANNEL,
  type TaskMoment,
} from "@/services/task-interest-moments";
import {
  delegationWakeCovers,
  startTaskSummaryTurn,
} from "@/services/task-interest-summary";

/**
 * How far back each tick looks for moments. The ledger, not a cursor, makes
 * each delivery happen once, so a send that failed is tried again on the
 * next tick for as long as its moment is inside this window. A deferred
 * summary is tried again from its ledger row, outside it.
 */
const LOOKBACK_MS = 48 * 60 * 60 * 1_000;
/** Moments delivered per tick; the rest wait for the next one. */
const MOMENT_BATCH = 200;
/** How long a deferred summary waits before it is tried again. */
const SUMMARY_RETRY_MS = 60 * 60 * 1_000;
/** The overdue sweep runs once per this many minutes, not every tick. */
const OVERDUE_SWEEP_MINUTES = 15;

const MESSAGE_KEYS: Record<MomentKind, string> = {
  completed: "Notifications.Task.completed",
  failed: "Notifications.Task.failed",
  canceled: "Notifications.Task.canceled",
  overdue: "Notifications.Task.overdue",
  dueDateMovedLater: "Notifications.Task.dueDateMovedLater",
};

export interface TaskInterestSyncResult {
  moments: number;
  sent: number;
  /** Summaries held back by the daily cap, credits or a busy bot. */
  deferred: number;
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
  participants: { select: { userId: true, createdAt: true } },
  followers: { select: { userId: true, createdAt: true } },
  // The latest settling event: a status moment holds only while it is this.
  events: {
    where: { status: { in: [...SETTLED_TASK_STATUSES] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { id: true },
  },
} as const satisfies Prisma.TaskSelect;

type MomentTask = Prisma.TaskGetPayload<{ select: typeof MOMENT_TASK_SELECT }>;

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
  // Reopened, or settled again since: this event is no longer the news.
  return (
    STATUS_MOMENTS[task.status as keyof typeof STATUS_MOMENTS] ===
      moment.kind && task.events[0]?.id === moment.eventId
  );
}

interface Audience {
  userId: string;
  /** When they first joined or followed, whichever came first. */
  since: Date;
  /** Their personal Soko Bot follows the Task for them. */
  follows: boolean;
}

/**
 * Participants and followers, one entry per person. Following and taking
 * part are separate lists: a follower need not be a participant.
 */
function audienceOf(task: MomentTask): Audience[] {
  const byUser = new Map<string, Audience>();
  for (const [rows, follows] of [
    [task.participants, false],
    [task.followers, true],
  ] as const) {
    for (const row of rows) {
      const known = byUser.get(row.userId);
      byUser.set(row.userId, {
        userId: row.userId,
        since:
          known && known.since < row.createdAt ? known.since : row.createdAt,
        follows: (known?.follows ?? false) || follows,
      });
    }
  }
  return [...byUser.values()];
}

/**
 * People the moment reaches: not its actor, still a workspace member, able
 * to see the Task, and on it or following it before the moment happened.
 */
async function reachedAudience(
  moment: TaskMoment,
  task: MomentTask,
  audience: Audience[],
) {
  const candidates = audience.filter(
    (person) =>
      person.userId !== moment.actorUserId &&
      isPrivateTaskVisibleToHuman(task, person.userId) &&
      (moment.at === null || person.since <= moment.at),
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
  input: { abortSignal: AbortSignal; shouldContinue: () => boolean },
  result: TaskInterestSyncResult,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: moment.taskId },
    select: MOMENT_TASK_SELECT,
  });
  if (!task) return;

  const ledger = await prisma.taskMomentDelivery.findMany({
    where: { taskId: task.id, momentKey: moment.key },
    select: { userId: true, channel: true, retryAt: true },
  });
  // A deferred summary that is due again is open, like one never tried.
  const decided = new Set(
    ledger
      .filter(
        (row) =>
          row.channel !== TASK_MOMENT_CHANNEL.deferred ||
          (row.retryAt !== null && row.retryAt > now),
      )
      .map((row) => row.userId),
  );
  const audience = audienceOf(task);
  const audienceIds = new Set(audience.map((p) => p.userId));
  const open = audience.filter((p) => !decided.has(p.userId));

  const record = (userId: string, channel: string, retryAt: Date | null) =>
    prisma.taskMomentDelivery.upsert({
      where: { userId_momentKey: { userId, momentKey: moment.key } },
      create: {
        userId,
        taskId: task.id,
        momentKey: moment.key,
        channel,
        retryAt,
      },
      update: { channel, retryAt },
    });

  // A deferred summary for someone who left or unfollowed: closed, so it
  // stops coming due.
  for (const row of ledger) {
    if (!decided.has(row.userId) && !audienceIds.has(row.userId)) {
      await record(row.userId, TASK_MOMENT_CHANNEL.none, null);
    }
  }
  if (open.length === 0) return;

  const reached = momentStillHolds(moment, task)
    ? await reachedAudience(moment, task, audience)
    : [];
  const reachedIds = new Set(reached.map((r) => r.userId));
  // Not reached now is final, for overdue too: it reached no one who is
  // not a member or cannot see the Task, and a Task that moved on is over.
  for (const person of open) {
    if (!reachedIds.has(person.userId)) {
      await record(person.userId, TASK_MOMENT_CHANNEL.none, null);
    }
  }

  const recipients = reached.filter((r) => !decided.has(r.userId));
  if (recipients.length === 0) return;
  const bots = await prisma.sokoBot.findMany({
    where: {
      userId: { in: recipients.map((r) => r.userId) },
      ...PERSONAL_BOT_WHERE,
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

  // Send first, record after. The cron lock keeps ticks apart, and every
  // send is idempotent (the notice key, the Notification's unique key, the
  // summary's client turn id), so a crash before the record only repeats a
  // send that already landed.
  for (const recipient of recipients) {
    if (!input.shouldContinue()) return;
    const inWorkspace = bots.find(
      (bot) =>
        bot.userId === recipient.userId && bot.workspaceId === task.workspaceId,
    );

    if (
      moment.kind === "overdue" &&
      moment.dueOn &&
      !isOverdueMomentDue(
        moment.dueOn,
        now,
        interestTimeZone(bots, recipient.userId, task.workspaceId),
      )
    ) {
      continue;
    }

    const followingBot =
      recipient.follows && inWorkspace && isFollowingSokoBot(inWorkspace)
        ? inWorkspace
        : null;

    try {
      let botPosted = false;
      if (followingBot && moment.kind === "completed") {
        const outcome = await startTaskSummaryTurn({
          momentKey: moment.key,
          task: {
            id: task.id,
            workspaceId: task.workspaceId,
            identifier: formatTaskIdentifier(
              task.project?.identifier,
              task.number,
            ),
          },
          userId: recipient.userId,
          sokoBotId: followingBot.id,
          completedBySokoBotId: moment.actorSokoBotId ?? null,
          abortSignal: input.abortSignal,
        }).catch((error) => {
          // An unexpected failure must not hold the moment until it leaves
          // the window: the bell takes it now.
          Sentry.captureException(error, {
            extra: { taskId: task.id, momentKey: moment.key },
          });
          return "gone" as const;
        });
        // Nothing recorded: the next tick tries again.
        if (outcome === "busy") {
          result.deferred += 1;
          continue;
        }
        if (outcome === "deferred") {
          await record(
            recipient.userId,
            TASK_MOMENT_CHANNEL.deferred,
            new Date(now.getTime() + SUMMARY_RETRY_MS),
          );
          result.deferred += 1;
          continue;
        }
        botPosted = outcome !== "gone";
      } else if (followingBot) {
        // A bot that delegated the Task hears of a failure or a cancel from
        // its own wake; a second, fixed notice would repeat it.
        const covered =
          (moment.kind === "failed" || moment.kind === "canceled") &&
          (await delegationWakeCovers({
            taskId: task.id,
            sokoBotId: followingBot.id,
            changedBySokoBotId: moment.actorSokoBotId ?? null,
          }));
        botPosted =
          covered ||
          (await sendSokoBotNotice(
            moment,
            task,
            recipient.userId,
            followingBot.id,
          ));
      }
      // The bot went away between the read and the post: the bell takes it.
      if (!botPosted) await sendBell(moment, task, recipient.userId);
      await record(
        recipient.userId,
        botPosted ? TASK_MOMENT_CHANNEL.sokoBot : TASK_MOMENT_CHANNEL.bell,
        null,
      );
      result.sent += 1;
    } catch (error) {
      // Nothing recorded: the next tick tries again. A deferred summary that
      // failed waits its interval again, so it cannot hold the retry queue.
      if (ledger.some((row) => row.userId === recipient.userId)) {
        await record(
          recipient.userId,
          TASK_MOMENT_CHANNEL.deferred,
          new Date(now.getTime() + SUMMARY_RETRY_MS),
        ).catch(() => undefined);
      }
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
 * Tell Task participants and followers about five moments: completed,
 * failed, canceled, overdue and due date moved later. A follower whose
 * personal Soko Bot is live hears it from the bot; everyone else gets a bell
 * Notification. The channel is chosen at send
 * time, and membership and visibility are checked again then.
 */
export async function syncTaskInterest(input: {
  shouldContinue: () => boolean;
  abortSignal: AbortSignal;
  now?: Date;
}): Promise<TaskInterestSyncResult> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const result: TaskInterestSyncResult = {
    moments: 0,
    sent: 0,
    deferred: 0,
    failed: 0,
  };

  // Fresh moments first, so fixed notices go out within the tick; deferred
  // summaries after, outside the batch. Their rows count as decided, so the
  // window scan never offers them twice. Overdue goes first: it is only
  // valid on one local morning, and status moments may spend the tick on
  // summaries.
  const fresh = (
    await dueNow(
      await openMoments([
        ...(now.getUTCMinutes() % OVERDUE_SWEEP_MINUTES === 0
          ? await overdueMoments(now)
          : []),
        ...(await dueDateMovedLaterMoments(since)),
        ...(await statusMoments(since)),
      ]),
      now,
    )
  ).slice(0, MOMENT_BATCH);
  const retries = await deferredMoments(now);
  const freshKeys = new Set(fresh.map((moment) => moment.key));
  const moments = [
    ...fresh,
    ...retries.filter((moment) => !freshKeys.has(moment.key)),
  ];

  for (const moment of moments) {
    if (!input.shouldContinue()) break;
    result.moments += 1;
    try {
      await deliverMoment(moment, now, input, result);
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
