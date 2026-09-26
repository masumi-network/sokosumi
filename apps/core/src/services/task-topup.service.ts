import {
  Channel,
  NotificationKind,
  type Prisma,
  TaskStatus,
} from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";

import {
  cancelNotificationEmails,
  EMAILED_NOTIFICATION_COLUMNS,
} from "@/helpers/notification-email-dispatch";
import { isPrismaRecordNotFoundError } from "@/helpers/prisma";

/**
 * Flip OUT_OF_CREDITS tasks to CREDITS_TOPPED_UP after a credit grant, scoped
 * to the organization when one is given, otherwise to the user. Tasks updated
 * concurrently (P2025) are skipped so the surrounding grant transaction is
 * never rolled back by a task race.
 */
export async function markOutOfCreditsTasksAsToppedUp(params: {
  organizationId: string | null;
  tx: Prisma.TransactionClient;
  userId: string | null;
}): Promise<void> {
  let taskWhere: { organizationId: string } | { ownerId: string };
  if (params.organizationId) {
    taskWhere = { organizationId: params.organizationId };
  } else {
    if (params.userId === null) {
      throw new Error("Personal credit top-up requires a user id");
    }
    taskWhere = { ownerId: params.userId };
  }

  const tasks = await params.tx.task.findMany({
    where: {
      ...taskWhere,
      status: TaskStatus.OUT_OF_CREDITS,
    },
    select: {
      id: true,
    },
  });

  for (const task of tasks) {
    try {
      await params.tx.task.update({
        where: {
          id: task.id,
          status: TaskStatus.OUT_OF_CREDITS,
        },
        data: {
          status: TaskStatus.CREDITS_TOPPED_UP,
          events: {
            create: {
              status: TaskStatus.CREDITS_TOPPED_UP,
              channel: Channel.SOKOSUMI,
              userId: params.userId,
              coworkerId: null,
            },
          },
        },
      });
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        continue;
      }

      throw error;
    }

    // Keep the credit request and task status consistent within the grant.
    const cleared = await params.tx.notification.updateManyAndReturn({
      where: {
        kind: NotificationKind.TASK,
        referenceId: task.id,
        messageKey: "Notifications.Task.outOfCredits",
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
      select: EMAILED_NOTIFICATION_COLUMNS,
    });

    // The credits are back, so the email saying they ran out is taken back.
    // Scheduled from inside the grant, so a grant that rolls back after this
    // has cancelled one email for a row that stays; the follow-up sync
    // reminds that reader a day later.
    waitUntil(cancelNotificationEmails(cleared));
  }
}
