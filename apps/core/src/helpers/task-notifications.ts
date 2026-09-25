import * as Sentry from "@sentry/node";
import { NotificationKind, TaskStatus } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

import { TASK_ATTENTION_MESSAGE_KEYS } from "./notification-delivery.js";
import {
  markAttentionRead,
  markSettledAttentionRead,
  TASK_RUN_ATTENTION_MESSAGE_KEYS,
} from "./notification-read.js";
import { createNotification } from "./notifications.js";

function taskNotificationPayload(task: {
  name: string | null;
  projectId: string | null;
  workspaceId: string | null;
  project?: { name: string } | null;
  extraMessageParams?: Record<string, unknown>;
}): {
  messageParams: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
} {
  const messageParams: Record<string, unknown> = {
    taskName: task.name ?? "Untitled task",
    ...task.extraMessageParams,
  };
  if (task.project?.name) {
    messageParams.projectName = task.project.name;
  }

  const metadata: Record<string, unknown> = {};
  if (task.projectId) {
    metadata.projectId = task.projectId;
  }
  if (task.workspaceId) {
    metadata.workspaceId = task.workspaceId;
  }

  return {
    messageParams,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}

/**
 * The readers a task's attention rows can belong to.
 *
 * The owner, plus the member it is assigned to when that is somebody else.
 * The owner comes first and once, because the two are the same person on
 * every task nobody delegated.
 */
function taskReaderIds(task: {
  ownerId: string;
  assigneeUserId: string | null;
}): string[] {
  if (!task.assigneeUserId || task.assigneeUserId === task.ownerId) {
    return [task.ownerId];
  }

  return [task.ownerId, task.assigneeUserId];
}

/**
 * Task-status notification dispatch, extracted from the task-events route so
 * the x402 pay endpoint's OUT_OF_CREDITS pause notifies the owner through the
 * exact same path. Best-effort by design: a notification failure must never
 * fail the request that committed the event.
 */
export async function dispatchTaskNotification(
  task: {
    id: string;
    ownerId: string;
    assigneeUserId: string | null;
    name: string | null;
    assignee: { name: string } | null;
    assigneeSokoBot: { name: string | null } | null;
    project: { name: string } | null;
    projectId: string | null;
    workspaceId: string | null;
  },
  eventId: string,
  status: string,
): Promise<void> {
  try {
    let messageKey: string;
    switch (status) {
      case "READY":
      case "QUEUED":
      case "RUNNING":
      case "AWAITING_EXTERNAL":
      case "CREDITS_TOPPED_UP":
        for (const readerId of taskReaderIds(task)) {
          await markAttentionRead(
            readerId,
            NotificationKind.TASK,
            task.id,
            TASK_RUN_ATTENTION_MESSAGE_KEYS,
            "task-resumed-read",
          );
        }
        return;
      case "INPUT_REQUIRED":
        messageKey = "Notifications.Task.inputRequired";
        break;
      case "APPROVAL_REQUIRED":
        messageKey = "Notifications.Task.approvalRequired";
        break;
      case "AUTHENTICATION_REQUIRED":
        messageKey = "Notifications.Task.authenticationRequired";
        break;
      case "OUT_OF_CREDITS":
        messageKey = "Notifications.Task.outOfCredits";
        break;
      case "COMPLETED":
        messageKey = "Notifications.Task.completed";
        break;
      case "FAILED":
        messageKey = "Notifications.Task.failed";
        break;
      case "CANCELED":
        messageKey = "Notifications.Task.canceled";
        break;
      default:
        return;
    }

    const { messageParams, metadata } = taskNotificationPayload({
      ...task,
      extraMessageParams: {
        coworkerName:
          task.assigneeSokoBot?.name?.trim() ||
          task.assignee?.name ||
          "Assistant",
      },
    });

    // A task that has settled is no longer waiting on either reader, however
    // it got there, so whatever it left unread stops being a question.
    //
    // Before the write because `createNotification` rethrows any write error
    // that is not a unique violation, and clearing afterwards would be skipped
    // on exactly the run that settled the task. The cost is the same failure's
    // other half: the rows are read and the outcome notification is never
    // written, so the reader is told nothing rather than told twice. That
    // loses less, because the reminder would have been wrong either way.
    for (const readerId of taskReaderIds(task)) {
      await markSettledAttentionRead(
        readerId,
        NotificationKind.TASK,
        task.id,
        messageKey,
      );
    }

    if (
      messageKey === "Notifications.Task.completed" ||
      messageKey === "Notifications.Task.failed" ||
      messageKey === "Notifications.Task.canceled"
    ) {
      await markParticipantAddedRead(task.id);
    }

    await createNotification({
      userId: task.ownerId,
      kind: NotificationKind.TASK,
      referenceId: task.id,
      eventId,
      messageKey,
      messageParams,
      metadata,
      ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        taskId: task.id,
        userId: task.ownerId,
        notificationType: "task-notification",
      },
    });
  }
}

/**
 * Loads the task's notification relations and dispatches the status
 * notification. The complete waitUntil body of the status-event paths —
 * callers schedule it after their transaction commits.
 */
export async function notifyTaskStatusEvent(
  taskId: string,
  eventId: string,
  status: string,
): Promise<void> {
  try {
    const taskWithRelations = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        ownerId: true,
        assigneeUserId: true,
        name: true,
        projectId: true,
        workspaceId: true,
        assignee: {
          select: {
            name: true,
          },
        },
        assigneeSokoBot: {
          select: {
            name: true,
          },
        },
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    if (taskWithRelations) {
      await dispatchTaskNotification(taskWithRelations, eventId, status);
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        taskId,
        eventId: eventId,
        notificationType: "task-notification",
      },
    });
  }
}

const TASK_ASSIGNED_MESSAGE_KEY = "Notifications.Task.assigned";
const TASK_PARTICIPANT_ADDED_MESSAGE_KEY =
  "Notifications.Task.participantAdded";

const TASK_SETTLED_STATUSES = [
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
];

/**
 * Notify each user the moment an @ in Task comment activity adds them.
 * A repeat mention is not passed in. Best-effort, same as assignee notify.
 *
 * Runs after the comment commits, so a removal, archive, or settlement can
 * land first and clear alerts before this starts. The Task and participant
 * rows are read again here so those users are not re-alerted.
 */
export async function notifyTaskParticipantsAdded(
  taskId: string,
  eventId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const task = await findTaskForParticipantAlert(
    taskId,
    eventId,
    userIds,
  ).catch((error) => {
    Sentry.captureException(error, {
      extra: {
        taskId,
        eventId,
        userIds,
        notificationType: "task-participant-notification",
      },
    });
    return null;
  });
  if (!task) {
    return;
  }

  const { messageParams, metadata } = taskNotificationPayload(task);
  const current = new Set(task.participants.map((row) => row.userId));
  for (const userId of userIds) {
    if (!current.has(userId)) {
      continue;
    }
    try {
      await createNotification({
        userId,
        kind: NotificationKind.TASK,
        referenceId: task.id,
        eventId,
        messageKey: TASK_PARTICIPANT_ADDED_MESSAGE_KEY,
        messageParams,
        metadata,
        ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
      });
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          taskId,
          eventId,
          userId,
          notificationType: "task-participant-notification",
        },
      });
    }
  }
}

/**
 * Null when the Task is archived or settled after the mentioning event.
 * Missing TaskEvent (self-join synthetic eventId) still alerts when the Task
 * is not archived and has no settled status event yet.
 */
async function findTaskForParticipantAlert(
  taskId: string,
  eventId: string,
  userIds: readonly string[],
) {
  const event = await prisma.taskEvent.findUnique({
    where: { id: eventId },
    select: { createdAt: true },
  });

  return prisma.task.findFirst({
    where: {
      id: taskId,
      archivedAt: null,
      events: event
        ? {
            none: {
              status: { in: TASK_SETTLED_STATUSES },
              createdAt: { gt: event.createdAt },
            },
          }
        : {
            none: {
              status: { in: TASK_SETTLED_STATUSES },
            },
          },
    },
    select: {
      id: true,
      name: true,
      projectId: true,
      workspaceId: true,
      project: { select: { name: true } },
      participants: {
        where: { userId: { in: [...userIds] } },
        select: { userId: true },
      },
    },
  });
}

/**
 * Notify a workspace member when they become the Task assignee.
 * Does not run for unassign or assign-to-agent. Best-effort.
 *
 * No account-wide opt-in read here. That field is the email gate, and this
 * row has no email behind it, so reading it silenced a notification the
 * reader could not switch back on. The `TASK_ATTENTION` row of the
 * preference matrix answers for it instead, resolved inside
 * `createNotification`.
 */
export async function notifyTaskHumanAssignee(
  taskId: string,
  assigneeUserId: string,
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        name: true,
        projectId: true,
        workspaceId: true,
        assigneeUserId: true,
        project: {
          select: { name: true },
        },
      },
    });

    if (!task || task.assigneeUserId !== assigneeUserId) {
      return;
    }

    const { messageParams, metadata } = taskNotificationPayload(task);

    await createNotification({
      userId: assigneeUserId,
      kind: NotificationKind.TASK,
      referenceId: task.id,
      eventId: crypto.randomUUID(),
      messageKey: TASK_ASSIGNED_MESSAGE_KEY,
      messageParams,
      metadata,
      ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        taskId,
        userId: assigneeUserId,
        notificationType: "task-assignee-notification",
      },
    });
  }
}

/**
 * Mark a member's `assigned` row read, because the task is no longer theirs.
 *
 * The row says "this task is yours", and a reassignment or an unassignment
 * makes it false. That is not covered by the settled read at the dispatcher
 * above, which reaches the assignee the task holds at the moment it settles,
 * and by then that is somebody else. Left alone the member keeps an unread
 * row for ever and the follow-up sync reminds them a day later about a task
 * they do not have (SOK-916, the reasoning of user stories 14 and 15).
 *
 * That one key and no more, because the previous holder is sometimes the
 * owner, and the owner's other attention rows are about a task that is still
 * theirs and still waiting.
 */
export async function markTaskAssignedRead(
  assigneeUserId: string,
  taskId: string,
): Promise<void> {
  await markAttentionRead(
    assigneeUserId,
    NotificationKind.TASK,
    taskId,
    [TASK_ASSIGNED_MESSAGE_KEY],
    "task-assigned-read",
  );
}

/**
 * Mark every outstanding attention row for an archived task read.
 *
 * Archiving is the fourth way a task stops waiting on somebody, after
 * completing, failing and being canceled, and it is the one the dispatcher
 * above never sees. Four of the seven archivable statuses are non-terminal
 * (`DRAFT`, `QUEUED`, `READY`, `GRANT_PENDING`), so a row asking a reader to
 * act can still be outstanding: the `assigned` row is written on assignment,
 * whatever the status. Nobody can open an archived task, so every such row is
 * now about a question nobody is asking.
 *
 * Every attention key rather than the assigned one, and both readers, because
 * archiving ends the task for all of them at once. That is what separates it
 * from a reassignment, which ends one row for one person.
 */
export async function markTaskArchivedRead(task: {
  id: string;
  ownerId: string;
  assigneeUserId: string | null;
}): Promise<void> {
  for (const readerId of taskReaderIds(task)) {
    await markAttentionRead(
      readerId,
      NotificationKind.TASK,
      task.id,
      TASK_ATTENTION_MESSAGE_KEYS,
      "task-archived-read",
    );
  }
  await markParticipantAddedRead(task.id);
}

async function markParticipantAddedRead(taskId: string): Promise<void> {
  try {
    const rows = await prisma.taskParticipant.findMany({
      where: { taskId },
      select: { userId: true },
    });
    for (const row of rows) {
      await markAttentionRead(
        row.userId,
        NotificationKind.TASK,
        taskId,
        [TASK_PARTICIPANT_ADDED_MESSAGE_KEY],
        "task-participant-settled-read",
      );
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: { taskId, notificationType: "task-participant-settled-read" },
    });
  }
}

/** The removed person is no longer on the task, so their added row stops waiting. */
export async function markTaskParticipantRemovedRead(
  userId: string,
  taskId: string,
): Promise<void> {
  await markAttentionRead(
    userId,
    NotificationKind.TASK,
    taskId,
    [TASK_PARTICIPANT_ADDED_MESSAGE_KEY],
    "task-participant-removed-read",
  );
}
