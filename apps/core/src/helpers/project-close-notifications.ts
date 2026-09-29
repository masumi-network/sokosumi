import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

import { createNotification } from "./notifications.js";

const PROJECT_CLOSE_NOTIFICATION_RETRY_BATCH_SIZE = 25;

interface ProjectCloseNotificationRetryOptions {
  abortSignal?: AbortSignal;
  deadlineMs?: number;
  shouldContinue?: () => boolean;
}

async function markProjectCloseNotificationHandled(eventId: string) {
  await prisma.projectEvent.updateMany({
    where: { id: eventId, notificationHandledAt: null },
    data: { notificationHandledAt: new Date() },
  });
}

function terminalMessageKey(
  kind: "BATCH_FAILED" | "CLOSE_FINALIZED",
  payload: Prisma.JsonValue | null,
): string | null {
  if (kind === "CLOSE_FINALIZED") {
    return "Notifications.Project.closed";
  }
  return payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    payload.failed === true
    ? "Notifications.Project.closeFailed"
    : null;
}

/** Notify the original close actor only while they can still access the Project. */
export async function notifyProjectCloseTransition(
  eventId: string,
): Promise<void> {
  try {
    const event = await prisma.projectEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        kind: true,
        notificationHandledAt: true,
        payload: true,
        closeOperation: { select: { actorUserId: true } },
        project: {
          select: { id: true, name: true, workspaceId: true },
        },
      },
    });
    if (
      !event ||
      event.notificationHandledAt !== null ||
      (event.kind !== "BATCH_FAILED" && event.kind !== "CLOSE_FINALIZED")
    ) {
      return;
    }

    const actorUserId = event.closeOperation?.actorUserId;
    const messageKey = terminalMessageKey(event.kind, event.payload);
    if (!actorUserId || !messageKey) {
      if (messageKey) {
        await markProjectCloseNotificationHandled(event.id);
      }
      return;
    }

    const accessibleWorkspace = await prisma.workspace.findFirst({
      where: {
        id: event.project.workspaceId,
        OR: [
          { userId: actorUserId },
          {
            organization: {
              members: { some: { userId: actorUserId } },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!accessibleWorkspace) {
      await markProjectCloseNotificationHandled(event.id);
      return;
    }

    await createNotification({
      userId: actorUserId,
      workspaceId: event.project.workspaceId,
      kind: NotificationKind.PROJECT,
      referenceId: event.project.id,
      eventId: event.id,
      messageKey,
      messageParams: { projectName: event.project.name },
      metadata: { workspaceId: event.project.workspaceId },
    });
    await markProjectCloseNotificationHandled(event.id);
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        eventId,
        notificationType: "project-close-notification",
      },
    });
  }
}

/** Retry terminal Project events whose idempotent notification is still missing. */
export async function retryMissingProjectCloseNotifications(
  options: ProjectCloseNotificationRetryOptions = {},
): Promise<void> {
  try {
    const events = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT event.id
      FROM "project_event" AS event
      JOIN "project" ON "project".id = event."projectId"
      JOIN "workspace" ON "workspace".id = "project"."workspaceId"
      JOIN "project_close_operation" AS operation
        ON operation.id = event."closeOperationId"
      WHERE (
          event.kind = 'CLOSE_FINALIZED'
          OR (
            event.kind = 'BATCH_FAILED'
            AND event.payload->>'failed' = 'true'
          )
        )
        AND operation."actorUserId" IS NOT NULL
        AND event."notificationHandledAt" IS NULL
      ORDER BY event."createdAt" ASC, event.id ASC
      LIMIT ${PROJECT_CLOSE_NOTIFICATION_RETRY_BATCH_SIZE}
    `;

    for (const event of events) {
      if (
        options.abortSignal?.aborted ||
        (options.deadlineMs !== undefined &&
          Date.now() >= options.deadlineMs) ||
        options.shouldContinue?.() === false
      ) {
        break;
      }
      await notifyProjectCloseTransition(event.id);
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: { notificationType: "project-close-notification-retry" },
    });
  }
}
