import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

export const MAX_HUMAN_MEMBERS_FOR_DIRECT_MESSAGE_NOTIFICATIONS = 2;

export interface ShouldEmitChatDirectMessageNotificationsParams {
  kind: string;
  memberUserIds: readonly string[];
}

export function shouldEmitChatDirectMessageNotifications(
  params: ShouldEmitChatDirectMessageNotificationsParams,
): boolean {
  return (
    params.kind === "direct" &&
    params.memberUserIds.length <=
      MAX_HUMAN_MEMBERS_FOR_DIRECT_MESSAGE_NOTIFICATIONS
  );
}

export interface EmitChatDirectMessageNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  authorUserId: string;
  authorName: string;
  recipientUserIds: readonly string[];
}

/** Emit CHAT notifications for other humans in a direct room. Schedule via waitUntil. */
export async function emitChatDirectMessageNotifications(
  params: EmitChatDirectMessageNotificationsParams,
): Promise<void> {
  const recipientUserIds = [
    ...new Set(
      params.recipientUserIds.filter(
        (userId) => userId !== params.authorUserId,
      ),
    ),
  ];

  if (recipientUserIds.length === 0) {
    return;
  }

  const mutedMemberships = await prisma.chatRoomUserMember.findMany({
    where: {
      roomId: params.roomId,
      userId: { in: recipientUserIds },
      mutedAt: { not: null },
    },
    select: { userId: true },
  });
  const mutedUserIds = new Set(
    mutedMemberships.map((membership) => membership.userId),
  );
  const notifyUserIds = recipientUserIds.filter(
    (userId) => !mutedUserIds.has(userId),
  );

  if (notifyUserIds.length === 0) {
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

  for (const userId of notifyUserIds) {
    try {
      await createNotification({
        userId,
        kind: NotificationKind.CHAT,
        referenceId: params.roomId,
        eventId: params.messageId,
        messageKey: "Notifications.Chat.directMessage",
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
          notificationType: "chat-direct-message-notification",
        },
      });
    }
  }
}
