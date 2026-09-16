import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

import { TASK_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";
import prisma from "@/lib/db/prisma";

import {
  markNotificationsRead,
  markSettledAttentionRead,
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

    // A task that has settled is no longer waiting on the reader, however it
    // got there. Whatever it left unread stops being a question, so it stops
    // being unread. Does nothing for the keys that are not terminal, and
    // reports rather than throws.
    //
    // Before the write rather than after it, because `createNotification`
    // does throw: it rethrows any write error that is not a unique violation.
    // Clearing afterwards would be skipped on exactly the run that settled the
    // task, and the reminder the stories rule out would go out anyway.
    //
    // The cost of this order is the other half of that failure: the rows are
    // read and the outcome notification is never written, so the reader is
    // told nothing rather than told twice. Both halves are rare and this one
    // loses less, because the follow-up would have been wrong either way.
    //
    // Both readers, because a task the owner delegated left the assignee an
    // `assigned` row of their own, and that row is waiting on the assignee.
    // The owner is written first and once: the two are the same person on
    // every task nobody delegated.
    const settledReaderIds = [task.ownerId];
    if (task.assigneeUserId && task.assigneeUserId !== task.ownerId) {
      settledReaderIds.push(task.assigneeUserId);
    }

    for (const readerId of settledReaderIds) {
      await markSettledAttentionRead(
        readerId,
        NotificationKind.TASK,
        task.id,
        messageKey,
      );
    }

    await createNotification({
      userId: task.ownerId,
      kind: NotificationKind.TASK,
      referenceId: task.id,
      eventId,
      messageKey,
      messageParams,
      metadata,
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

/**
 * Notify a workspace member when they become the Task assignee.
 * Does not run for unassign or assign-to-agent. Best-effort.
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

    const assignee = await prisma.user.findUnique({
      where: { id: assigneeUserId },
      select: { notificationsOptIn: true },
    });

    if (!assignee?.notificationsOptIn) {
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
 * Mark a reader's outstanding attention rows for one task read.
 *
 * Best-effort, like every other notification write on this path: the write it
 * follows has already committed and must not be undone by a failure to tidy
 * up after it.
 */
async function markTaskAttentionRead(
  userId: string,
  taskId: string,
  messageKeys: readonly string[],
  notificationType: string,
): Promise<void> {
  try {
    await markNotificationsRead(userId, {
      kind: NotificationKind.TASK,
      referenceId: taskId,
      messageKey: { in: [...messageKeys] },
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: { taskId, userId, notificationType },
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
  await markTaskAttentionRead(
    assigneeUserId,
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
 * above never sees. A task can be archived from `DRAFT`, `QUEUED`, `READY`
 * and `GRANT_PENDING`, so a row asking the owner to act can still be
 * outstanding: the operator-removed-schedule row is written with no status
 * condition at all. Nobody can open an archived task, so every such row is
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
  const readerIds = [task.ownerId];
  if (task.assigneeUserId && task.assigneeUserId !== task.ownerId) {
    readerIds.push(task.assigneeUserId);
  }

  for (const readerId of readerIds) {
    await markTaskAttentionRead(
      readerId,
      task.id,
      TASK_ATTENTION_MESSAGE_KEYS,
      "task-archived-read",
    );
  }
}
