import { NotificationKind, type Prisma } from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";

import { notificationFeedWhere } from "@/helpers/notification-feed";
import prisma from "@/lib/db/prisma";

/**
 * Mark a reader's unread notification-center rows as read.
 *
 * `scope` narrows which of them, so read-all passes nothing and the batch
 * route passes the ids it was given. The feed rule and the reader's own
 * `userId` are applied here rather than by the caller, so a route cannot
 * reach a row the feed would never show, or someone else's row, by
 * forgetting one of them.
 *
 * Returns the ids of the room rows the write cleared: the counted room row is
 * the one a banner stands for, so it is the only row whose reading takes a
 * banner down. The rows come back from the write itself, so a notification
 * arriving during the request is published too if this write marked it read.
 */
export async function markNotificationsRead(
  userId: string,
  scope: Prisma.NotificationWhereInput = {},
): Promise<{ count: number; clearedRoomIds: string[] }> {
  const clearedRows = await prisma.notification.updateManyAndReturn({
    where: {
      ...scope,
      userId,
      isRead: false,
      ...notificationFeedWhere(),
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
    select: { id: true, kind: true, messageKey: true },
  });

  return {
    count: clearedRows.length,
    clearedRoomIds: clearedRows
      .filter(
        (row) =>
          row.kind === NotificationKind.CHAT &&
          row.messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      )
      .map((row) => row.id),
  };
}
