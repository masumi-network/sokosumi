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

  const rows = await tx.notification.findMany({
    where: {
      userId,
      kind: NotificationKind.CHAT,
      messageKey: { in: [...CHAT_ROOM_BADGE_MESSAGE_KEYS] },
      isRead: false,
      referenceId: { in: uniqueRoomIds },
    },
    select: { id: true, referenceId: true, eventId: true },
  });
  if (rows.length === 0) {
    return new Map();
  }

  const passedRows = await findThreadReplyRowsPassedByRoomRead(
    [...new Set(rows.map((row) => row.referenceId))],
    userId,
    tx,
  );
  const passedIds = new Set(passedRows.map((row) => row.id));
  const messagesByRoom = new Map<string, Set<string>>();
  for (const row of rows) {
    if (passedIds.has(row.id)) continue;
    const messages = messagesByRoom.get(row.referenceId) ?? new Set<string>();
    // Complementary mention and Direct channels still describe one message.
    messages.add(row.eventId);
    messagesByRoom.set(row.referenceId, messages);
  }

  return new Map(
    [...messagesByRoom].map(([roomId, messages]) => [roomId, messages.size]),
  );
}
