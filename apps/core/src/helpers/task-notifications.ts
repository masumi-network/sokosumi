import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

import { createNotification } from "./notifications.js";

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
    name: string | null;
    assignee: { name: string } | null;
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

    const taskName = task.name ?? "Untitled task";
    const coworkerName = task.assignee?.name ?? "Assistant";
    const projectName = task.project?.name;

    const messageParams: Record<string, unknown> = {
      coworkerName,
      taskName,
    };

    if (projectName) {
      messageParams.projectName = projectName;
    }

    const metadata: Record<string, unknown> = {};
    if (task.projectId) {
      metadata.projectId = task.projectId;
    }
    if (task.workspaceId) {
      metadata.workspaceId = task.workspaceId;
    }

    await createNotification({
      userId: task.ownerId,
      kind: NotificationKind.TASK,
      referenceId: task.id,
      eventId,
      messageKey,
      messageParams,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
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
        name: true,
        projectId: true,
        workspaceId: true,
        assignee: {
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
