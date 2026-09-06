import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

export interface FanOutChatNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  recipientUserIds: readonly string[];
  /** Decides which preference row the reader reads this under. */
  messageKey: string;
  /** Sentry tag, so a failed emit names which chat notification it was. */
  notificationType: string;
}

/**
 * The steps every chat notification shares: drop the author, drop the readers
 * who muted the room, and write one notification each.
 *
 * A mention, a direct message and a room message differ only in the message
 * key they carry and the preference row that key maps to. Keeping the fan-out
 * in one place means a fix to the mute rule or the workspace lookup reaches all
 * three, and a fourth chat notification is a message key rather than another
 * copy of this function.
 *
 * One recipient's failure never costs the others theirs, so each write is
 * caught and reported on its own.
 */
export async function fanOutChatNotifications(
  params: FanOutChatNotificationsParams,
): Promise<void> {
  const recipientUserIds = [
    ...new Set(
      params.recipientUserIds.filter(
        (userId) =>
          params.authorUserId === null || userId !== params.authorUserId,
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
        messageKey: params.messageKey,
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
          notificationType: params.notificationType,
        },
      });
    }
  }
}
