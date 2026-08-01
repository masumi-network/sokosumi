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

/**
 * Emit CHAT in-app notifications for human @mentions after a user message
 * commits. Callers should schedule this via waitUntil so notify failures never
 * fail the HTTP create. createNotification is idempotent on
 * (userId, kind, referenceId, eventId, messageKey).
 */
export async function emitChatMentionNotifications(
  params: EmitChatMentionNotificationsParams,
): Promise<void> {
  const recipientUserIds = [
    ...new Set(
      params.mentionedUserIds.filter(
        (userId) => userId && userId !== params.authorUserId,
      ),
    ),
  ];

  if (recipientUserIds.length === 0) {
    return;
  }

  let workspaceId: string | null = null;
  try {
    if (params.organizationId) {
      const workspace = await prisma.workspace.findUnique({
        where: { organizationId: params.organizationId },
        select: { id: true },
      });
      workspaceId = workspace?.id ?? null;
    }
  } catch (error) {
    console.error(
      "Failed to resolve workspace for chat mention notification:",
      {
        roomId: params.roomId,
        messageId: params.messageId,
        organizationId: params.organizationId,
        error,
      },
    );
    Sentry.captureException(error, {
      extra: {
        roomId: params.roomId,
        messageId: params.messageId,
        organizationId: params.organizationId,
        notificationType: "chat-mention-workspace-lookup",
      },
    });
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
          roomId: params.roomId,
          messageId: params.messageId,
          workspaceId,
          organizationId: params.organizationId,
        },
      });
    } catch (error) {
      console.error("Failed to emit chat mention notification:", {
        roomId: params.roomId,
        messageId: params.messageId,
        userId,
        error,
      });
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
