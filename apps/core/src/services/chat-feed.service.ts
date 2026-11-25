import { sharedTable } from "@sokosumi/database/sql-tables";

import prisma from "@/lib/db/prisma";
import { sqlMessageAttentionAt } from "@/routes/v1/chats/rooms/room-unread";
import {
  loadListedMessages,
  placeholders,
  readerRooms,
  sqlNeedsViewer,
  sqlReadJoins,
  sqlUnreadForViewer,
} from "@/services/chat-signal-views.service";

/**
 * SQL predicate: message `m` in room `r` belongs in the viewer's Feed. It is
 * live, from someone else, and one of: a person's message in a Direct, a
 * message that mentions the viewer, a question or decision Jev addressed to
 * the viewer, or an agent's answer to a message the viewer sent or was
 * mentioned in. An agent answer counts once it is complete: a Thought
 * placeholder still waiting, or one that failed, is not an answer. An agent
 * answer in a room with one person is that person's own conversation with the
 * agent, so it stays out. The viewer must still be an unmuted member of a
 * room that is not archived when the query runs: the room list is read
 * first, and a removal, a mute or an archive between the two reads must not
 * leak that room's messages.
 */
function sqlFeedCandidate(userSql: string): string {
  return `m."deletedAt" IS NULL
    AND r."archivedAt" IS NULL
    AND m."senderUserId" IS DISTINCT FROM ${userSql}
    AND EXISTS (
      SELECT 1 FROM ${sharedTable("chat_room_user_member").sql} viewer
      WHERE viewer."roomId" = m."roomId" AND viewer."userId" = ${userSql}
        AND viewer."mutedAt" IS NULL)
    AND (
      (r.kind = 'direct' AND m."senderUserId" IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM ${sharedTable("chat_room_user_mention").sql} mention
        WHERE mention."messageId" = m.id AND mention."userId" = ${userSql})
      OR EXISTS (
        SELECT 1 FROM ${sharedTable("chat_message_signal").sql} s
        WHERE s."messageId" = m.id AND s.state = 'tagged'
          AND ${sqlNeedsViewer(userSql)})
      OR (EXISTS (
          SELECT 1 FROM ${sharedTable("chat_room_mention").sql} asked
          INNER JOIN ${sharedTable("chat_room_message").sql} source ON source.id = asked."messageId"
          WHERE asked."responseMessageId" = m.id
            AND asked.status = 'responded'
            AND (source."senderUserId" = ${userSql}
              OR EXISTS (
                SELECT 1 FROM ${sharedTable("chat_room_user_mention").sql} source_mention
                WHERE source_mention."messageId" = source.id
                  AND source_mention."userId" = ${userSql})))
        AND (SELECT COUNT(*) FROM ${sharedTable("chat_room_user_member").sql} member
          WHERE member."roomId" = m."roomId") > 1)
    )`;
}

/**
 * The viewer's Feed: the chat messages that need them, across the rooms
 * their sidebar lists, unmuted, Thread replies too. Newest first; `after` is
 * a position, not a row, so equal timestamps and a since-deleted boundary
 * message lose nothing.
 */
export async function listChatFeed(
  userId: string,
  organizationId: string | null,
  page: { after?: { createdAt: Date; id: string }; take: number },
) {
  const rooms = await readerRooms(userId, organizationId);
  if (rooms.length === 0) return { items: [], hasMore: false, unreadCount: 0 };
  const n = rooms.length;
  const user = `$${n + 1}`;
  const roomIds = rooms.map((room) => room.id);
  const [rows, unread] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT m.id
      FROM ${sharedTable("chat_room_message").sql} m
      INNER JOIN ${sharedTable("chat_room").sql} r ON r.id = m."roomId"
      WHERE m."roomId" IN (${placeholders(n)})
        AND ${sqlFeedCandidate(user)}
        ${page.after ? `AND (m."createdAt", m.id) < ($${n + 3}, $${n + 4}::uuid)` : ""}
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT $${n + 2}`,
      ...roomIds,
      userId,
      page.take + 1,
      ...(page.after ? [page.after.createdAt, page.after.id] : []),
    ),
    // Unread by attention time: an agent answer completes after its Thought
    // placeholder was posted, and reading the placeholder must not mark the
    // answer read. Paging keeps `createdAt`, the message's place in time.
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count
      FROM ${sharedTable("chat_room_message").sql} m
      INNER JOIN ${sharedTable("chat_room").sql} r ON r.id = m."roomId"
      ${sqlReadJoins(user)}
      WHERE m."roomId" IN (${placeholders(n)})
        AND ${sqlFeedCandidate(user)}
        AND ${sqlUnreadForViewer(sqlMessageAttentionAt("m"))}`,
      ...roomIds,
      userId,
    ),
  ]);
  const ids = rows.slice(0, page.take).map((row) => row.id);
  const messages = new Map(
    (await loadListedMessages(ids)).map((message) => [message.id, message]),
  );
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const items = ids.flatMap((id) => {
    const message = messages.get(id);
    const room = message && roomById.get(message.roomId);
    if (!message || !room) return [];
    return [
      {
        lane: "feed" as const,
        room: {
          id: room.id,
          name: room.groupName ?? room.name,
          kind: room.kind,
        },
        message,
      },
    ];
  });
  return {
    items,
    hasMore: rows.length > page.take,
    unreadCount: Number(unread[0]?.count ?? 0),
  };
}
