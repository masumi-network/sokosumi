import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

export interface EmitChatMentionNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  authorUserId: string;
  authorName: string;
  mentionedUserIds: readonly string[];
}

/** Emit CHAT notifications for human @mentions. Schedule via waitUntil. */
export async function emitChatMentionNotifications(
  params: EmitChatMentionNotificationsParams,
): Promise<void> {
  const recipientUserIds = [
    ...new Set(
      params.mentionedUserIds.filter(
        (userId) => userId !== params.authorUserId,
      ),
    ),
  ];

  if (recipientUserIds.length === 0) {
    return;
  }

  let workspaceId: string | null = null;
  if (params.organizationId) {
    const workspace = await prisma.workspace.findUnique({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });
    workspaceId = workspace?.id ?? null;
  }

  for (const userId of recipientUserIds) {
    try {
      await createNotification({
        userId,
        kind: NotificationKind.CHAT,
        referenceId: params.roomId,
        eventId: params.messageId,
        messageKey: "Notifications.Chat.mentioned",
        messageParams: {
          authorName: params.authorName,
          roomName: params.roomName,
        },
        metadata: {
          messageId: params.messageId,
          workspaceId,
        },
      });
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          roomId: params.roomId,
          messageId: params.messageId,
          userId,
          notificationType: "chat-mention-notification",
        },
      });
    }
  }
}
