import { NotificationKind, type Prisma } from "@sokosumi/database";

import { findThreadReplyRowsPassedByRoomRead } from "@/helpers/chat-thread-reply-notifications";
import { CHAT_ROOM_BADGE_MESSAGE_KEYS } from "@/helpers/notification-delivery";

import { normalizeUniqueStrings } from "./helpers";

/**
 * Per-room count of the unread chat notifications a badge is for.
 *
 * `referenceId` is the room id, and every chat notification carries the same
 * `NotificationKind.CHAT`, so the message key is the only thing that says which
 * of them was addressed to the reader. `CHAT_ROOM_BADGE_MESSAGE_KEYS` is that
 * list. Counting the kind alone made a badge out of every message in a room the
 * moment `CHAT_ROOM_MESSAGE` gave rooms a third notification.
 *
 * A Thread reply's row that Room last-read has passed is left out (SOK-1217):
 * see `findThreadReplyRowsPassedByRoomRead`.
 */
export async function getChatRoomUnreadMentionCounts(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, number>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const groups = await tx.notification.groupBy({
    by: ["referenceId"],
    where: {
      userId,
      kind: NotificationKind.CHAT,
      messageKey: { in: [...CHAT_ROOM_BADGE_MESSAGE_KEYS] },
      isRead: false,
      referenceId: { in: uniqueRoomIds },
    },
    _count: { _all: true },
  });
  if (groups.length === 0) {
    return new Map();
  }

  const counts = new Map(
    groups.map((group) => [group.referenceId, group._count._all] as const),
  );
  const passedRows = await findThreadReplyRowsPassedByRoomRead(
    [...counts.keys()],
    userId,
    tx,
  );
  for (const row of passedRows) {
    const remaining = (counts.get(row.roomId) ?? 0) - 1;
    if (remaining > 0) {
      counts.set(row.roomId, remaining);
    } else {
      counts.delete(row.roomId);
    }
  }

  return counts;
}
