import * as Sentry from "@sentry/node";

import prisma from "@/lib/db/prisma";
import { calendarInvalidationOutboxService } from "@/services/calendar-invalidation-outbox.service";

/** Deliver committed Calendar invalidations immediately; the cron remains the retry path. */
export async function deliverCalendarInvalidationsNow(
  workspaceId: string,
): Promise<void> {
  try {
    await calendarInvalidationOutboxService.syncInvalidations({
      maxBatches: 1,
      newestFirst: true,
      shouldContinue: () => true,
      workspaceId,
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        workspaceId,
        notificationType: "calendar-invalidation-delivery",
      },
    });
  }
}

/** Resolve a Task's workspace without letting post-commit delivery change mutation semantics. */
export async function deliverTaskCalendarInvalidationsNow(
  taskId: string,
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (task) {
      await deliverCalendarInvalidationsNow(task.workspaceId);
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        taskId,
        notificationType: "task-calendar-invalidation-delivery",
      },
    });
  }
}

/** Resolve an organization workspace after membership removal, then drain its committed revocation. */
export async function deliverOrganizationCalendarInvalidationsNow(
  organizationId: string,
  revokedUserId?: string,
): Promise<void> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { organizationId },
      select: { id: true },
    });

    if (workspace) {
      await calendarInvalidationOutboxService.syncInvalidations({
        maxBatches: 1,
        newestFirst: true,
        revokedUserId,
        shouldContinue: () => true,
        workspaceId: workspace.id,
      });
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        organizationId,
        revokedUserId,
        notificationType: "calendar-access-revocation-delivery",
      },
    });
  }
}
