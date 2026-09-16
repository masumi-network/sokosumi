import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

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
    // does throw: it rethrows anything that is not a unique violation, and a
    // failed realtime publish is one of those. Clearing afterwards would be
    // skipped on exactly the run that settled the task, and the reminder the
    // stories rule out would go out anyway.
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
 * Mark the `assigned` row read for the member the task has just left.
 *
 * The row says "this task is yours", and it stops being true the moment the
 * task moves to somebody else or to nobody. Nothing else clears it: the
 * settled read at the dispatcher above reaches the assignee the task holds
 * when it settles, which by then is a different person. Left alone, the
 * previous holder keeps an unread row for ever and the follow-up sync
 * reminds them a day later about a task they no longer have (SOK-916, the
 * same reasoning as user stories 14 and 15).
 *
 * Best-effort, like every other notification write on this path: the
 * reassignment it follows has already committed and must not be undone by a
 * failure to tidy up after it.
 */
export async function markTaskHandedOverRead(
  previousAssigneeUserId: string,
  taskId: string,
): Promise<void> {
  try {
    await markNotificationsRead(previousAssigneeUserId, {
      kind: NotificationKind.TASK,
      referenceId: taskId,
      messageKey: TASK_ASSIGNED_MESSAGE_KEY,
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        taskId,
        userId: previousAssigneeUserId,
        notificationType: "task-handed-over-read",
      },
    });
  }
}
