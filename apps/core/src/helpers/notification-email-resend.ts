import * as Sentry from "@sentry/node";
import { notificationEmailSource } from "@/helpers/notification-chat-email-source";
import {
  cancelNotificationEmails,
  dispatchNotificationEmail,
} from "@/helpers/notification-email-dispatch";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import { resolveDelivery } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

/**
 * Send this room row's email again, because it now stands for one more
 * message.
 *
 * The new email is handed over before the old one is taken back, so a send
 * that fails leaves the reader with the email they already had rather than
 * with none. The cost of the other order would be silence; the cost of this
 * one is a duplicate when the cancel fails, which is the cheaper failure.
 *
 * Does nothing for a row whose email has already left, or never had one:
 * there is nothing left to say it differently (SOK-1142).
 * A new counted arrival can recover an interrupted first send after checking consent.
 *
 * Never throws, and meant for `waitUntil`.
 */
export async function resendRoomMessageEmail(
  notificationId: string,
  options: { allowInitialSend?: boolean } = {},
): Promise<void> {
  try {
    const row = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!row) {
      return;
    }
    if (
      row.emailId !== null &&
      row.emailScheduledAt !== null &&
      row.emailScheduledAt.getTime() > Date.now() &&
      (await notificationEmailSource(row)) === "none"
    ) {
      await cancelNotificationEmails([row]);
      return;
    }
    if (row.isRead) return;
    if (row.emailId === null) {
      if (!options.allowInitialSend) return;
      const messageParams = readNotificationRowJson(
        row.messageParams,
        row.id,
        "messageParams",
      );
      const metadata =
        row.metadata === null
          ? null
          : readNotificationRowJson(row.metadata, row.id, "metadata");
      if (!messageParams || (row.metadata !== null && metadata === null))
        return;
      const delivery = await resolveDelivery({
        ...row,
        workspaceId: row.workspaceId ?? undefined,
        messageParams,
        metadata,
      });
      if (delivery.email) await dispatchNotificationEmail(row);
      return;
    }
    if (
      row.emailScheduledAt === null ||
      row.emailScheduledAt.getTime() <= Date.now()
    )
      return;

    // The write of the new email's id takes the old one back. A dispatch
    // that sent nothing leaves the old one standing, so the reader keeps
    // the email they already had.
    await dispatchNotificationEmail(row, { scheduledAt: row.emailScheduledAt });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        notificationId,
        notificationType: "notification-email-resend",
      },
    });
  }
}
