import { NotificationKind, type Prisma } from "@sokosumi/database";

import { CHAT_ROOM_BADGE_MESSAGE_KEYS } from "@/helpers/notification-delivery";
import {
  EMAILED_NOTIFICATION_COLUMNS,
  type EmailedNotificationRow,
} from "@/helpers/notification-email-dispatch";

/** An unread mention or direct-message row written for a Thread reply. */
export interface UnreadThreadReplyRow {
  id: string;
  roomId: string;
  parentMessageId: string;
  /** When the reply became readable, as `sqlMessageAttentionAt` reads it. */
  replyAttentionAt: Date;
}

/**
 * The reader's unread mention and direct-message rows about replies in Threads
 * they Participate in (SOK-1217).
 *
 * A Thread is read by a Look, not by Room last-read (ADR-0037), so these rows
 * belong to the Thread: Room last-read leaves them unread and a Look clears
 * them. Left to Room last-read, opening the room marked them read while the
 * Thread stayed unread, and the follow-up sync never saw them.
 *
 * Participant is ADR-0013's rule, the same one the unread query applies: the
 * reader wrote the parent, replied, or was named in the Thread. A lurker
 * Thread is not unread for the reader anywhere, so its rows stay with Room
 * last-read as before. A deleted reply is no longer anything to read.
 *
 * Only the badge keys are per message: their `eventId` is the message id. The
 * room-message row counts many messages onto one row about the room, so it
 * stays with Room last-read too.
 */
export async function findUnreadThreadReplyRows(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<UnreadThreadReplyRow[]> {
  if (roomIds.length === 0) {
    return [];
  }

  const rows = await tx.notification.findMany({
    where: {
      userId,
      kind: NotificationKind.CHAT,
      referenceId: { in: [...roomIds] },
      messageKey: { in: [...CHAT_ROOM_BADGE_MESSAGE_KEYS] },
      isRead: false,
    },
    select: { id: true, referenceId: true, eventId: true },
  });
  if (rows.length === 0) {
    return [];
  }

  const replies = await tx.chatRoomMessage.findMany({
    where: {
      id: { in: rows.map((row) => row.eventId) },
      parentMessageId: { not: null },
      deletedAt: null,
    },
    select: { id: true, roomId: true, parentMessageId: true, createdAt: true },
  });
  if (replies.length === 0) {
    return [];
  }

  const participatingParentIds = await findParticipatingParentIds(
    replies.flatMap((reply) =>
      reply.parentMessageId ? [reply.parentMessageId] : [],
    ),
    userId,
    tx,
  );
  const repliesById = new Map(replies.map((reply) => [reply.id, reply]));
  // A coworker's Thought placeholder keeps its createdAt; its answer becomes
  // readable when the mention reaches responded (`sqlMessageAttentionAt`).
  const responded = await tx.chatRoomMention.findMany({
    where: {
      responseMessageId: { in: replies.map((reply) => reply.id) },
      status: "responded",
    },
    select: { responseMessageId: true, updatedAt: true },
  });
  const respondedAt = new Map(
    responded.map((mention) => [mention.responseMessageId, mention.updatedAt]),
  );

  return rows.flatMap((row) => {
    const reply = repliesById.get(row.eventId);
    if (
      !reply?.parentMessageId ||
      reply.roomId !== row.referenceId ||
      !participatingParentIds.has(reply.parentMessageId)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        roomId: row.referenceId,
        parentMessageId: reply.parentMessageId,
        replyAttentionAt: laterOf(reply.createdAt, respondedAt.get(reply.id)),
      },
    ];
  });
}

function laterOf(first: Date, second: Date | undefined): Date {
  return second !== undefined && second > first ? second : first;
}

/**
 * Which of these Threads the reader Participates in (ADR-0013).
 *
 * The same three ways in as `sqlViewerIsThreadParticipant` in
 * `room-unread.ts`: wrote the parent, replied, or was named on the parent or a
 * reply. A deleted parent is no Thread at all, as there. Mute is left out on
 * purpose: a muted Thread's Look is written by the mute itself, and a mention
 * breaks through it (ADR-0030).
 */
async function findParticipatingParentIds(
  parentMessageIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Set<string>> {
  // Sequential: these may run on an interactive transaction client.
  const parents = await tx.chatRoomMessage.findMany({
    where: { id: { in: [...new Set(parentMessageIds)] }, deletedAt: null },
    select: { id: true, senderUserId: true },
  });
  const ids = parents.map((parent) => parent.id);
  if (ids.length === 0) {
    return new Set();
  }
  const authored = parents.filter((parent) => parent.senderUserId === userId);
  const replied = await tx.chatRoomMessage.findMany({
    where: {
      parentMessageId: { in: ids },
      senderUserId: userId,
      deletedAt: null,
    },
    select: { parentMessageId: true },
    distinct: ["parentMessageId"],
  });
  const named = await tx.chatRoomUserMention.findMany({
    where: {
      userId,
      message: {
        deletedAt: null,
        OR: [{ id: { in: ids } }, { parentMessageId: { in: ids } }],
      },
    },
    select: { message: { select: { id: true, parentMessageId: true } } },
  });

  return new Set([
    ...authored.map((parent) => parent.id),
    ...replied.flatMap((reply) =>
      reply.parentMessageId ? [reply.parentMessageId] : [],
    ),
    ...named.map(({ message }) => message.parentMessageId ?? message.id),
  ]);
}

/**
 * The rows of `findUnreadThreadReplyRows` that Room last-read has passed.
 *
 * Room last-read leaves them unread, because only a Look reads a Thread, but
 * every count of what is new in the room drops them once the reader has
 * opened it past the reply, as it did when Room last-read cleared them. Until
 * then a Thread mention keeps marking the channel (ADR-0037).
 */
export async function findThreadReplyRowsPassedByRoomRead(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<UnreadThreadReplyRow[]> {
  const rows = await findUnreadThreadReplyRows(roomIds, userId, tx);
  if (rows.length === 0) {
    return [];
  }

  const readStates = await tx.chatRoomReadState.findMany({
    where: {
      userId,
      roomId: { in: [...new Set(rows.map((row) => row.roomId))] },
    },
    select: { roomId: true, lastReadAt: true },
  });
  const roomReadAt = new Map(
    readStates.map((state) => [state.roomId, state.lastReadAt]),
  );

  return rows.filter((row) => {
    const readAt = roomReadAt.get(row.roomId);
    return readAt !== undefined && readAt >= row.replyAttentionAt;
  });
}

/**
 * Mark read the reader's Thread-reply rows in a room that a Look now covers.
 *
 * Called after a Look is written. Lurker Threads have none here: Room
 * last-read clears those. Returns the cleared rows, for the caller to publish
 * and to cancel their emails once its write has committed.
 */
export async function markLookedThreadReplyRowsRead(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
  readAt: Date = new Date(),
): Promise<EmailedNotificationRow[]> {
  const rows = await findUnreadThreadReplyRows([roomId], userId, tx);
  return markCoveredThreadReplyRowsRead(rows, userId, tx, readAt);
}

/**
 * Mark read those of `rows` that the reader's Look covers: its Thread's look
 * state is at or after the reply, so a Thread the Look skipped keeps its
 * rows. Room last-read calls it directly for a row written after its Look.
 */
export async function markCoveredThreadReplyRowsRead(
  rows: readonly UnreadThreadReplyRow[],
  userId: string,
  tx: Prisma.TransactionClient,
  readAt: Date,
): Promise<EmailedNotificationRow[]> {
  if (rows.length === 0) {
    return [];
  }

  const looks = await tx.chatRoomThreadReadState.findMany({
    where: {
      userId,
      parentMessageId: {
        in: [...new Set(rows.map((row) => row.parentMessageId))],
      },
    },
    select: { parentMessageId: true, lastReadAt: true },
  });
  const lookedAt = new Map(
    looks.map((look) => [look.parentMessageId, look.lastReadAt]),
  );
  const coveredIds = rows
    .filter((row) => {
      const looked = lookedAt.get(row.parentMessageId);
      return looked !== undefined && looked >= row.replyAttentionAt;
    })
    .map((row) => row.id);
  if (coveredIds.length === 0) {
    return [];
  }

  return tx.notification.updateManyAndReturn({
    where: { id: { in: coveredIds }, userId, isRead: false },
    data: { isRead: true, readAt },
    select: EMAILED_NOTIFICATION_COLUMNS,
  });
}
