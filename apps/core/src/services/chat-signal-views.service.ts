import type { Prisma } from "@sokosumi/database";
import { notFound } from "@/helpers/error";
import {
  CHAT_CATCH_UP_BUCKETS,
  type ChatCatchUpBucket,
  type ChatOpenLoopKind,
  chatCatchUpBucket,
  chatOpenLoopKind,
  OPEN_QUESTION_AFTER_MS,
  sqlChatSignalHasTag,
  storedChatSignalTags,
} from "@/lib/chat-signals/derive";
import type { ChatSignalTag } from "@/lib/chat-signals/tags";
import prisma from "@/lib/db/prisma";
import {
  chatRoomMessageInclude,
  membershipVisibleActiveRoomWhere,
  requireChatRoomUserMembership,
} from "@/routes/v1/chats/rooms/helpers";

/** How far back open loops and the cross-room lists look. */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_LISTED = 50;

/** Signal fields every derivation reads, corrections oldest first. */
export const chatSignalSelect = {
  state: true,
  probabilities: true,
  addressedUserIds: true,
  commitmentDueAt: true,
  loopClosedAt: true,
  loopTaskId: true,
  corrections: {
    select: { tag: true, applies: true },
    orderBy: { updatedAt: "asc" },
  },
} as const satisfies Prisma.ChatMessageSignalSelect;

/** `$1::uuid, …, $n::uuid` for a list of room ids leading the parameters. */
function placeholders(count: number): string {
  return Array.from({ length: count }, (_, i) => `$${i + 1}::uuid`).join(", ");
}

/**
 * SQL predicate: message `m` is unread for the viewer `userSql`, by the same
 * baselines as room unread: a top-level message after the room's last read,
 * a reply after the Thread's Look (else the viewer's join). Needs the
 * `room_read` and `thread_read` joins.
 */
function sqlUnreadForViewer(): string {
  return `(
    (m."parentMessageId" IS NULL
      AND m."createdAt" > COALESCE(room_read."lastReadAt", '-infinity'::timestamp))
    OR (m."parentMessageId" IS NOT NULL
      AND m."createdAt" > COALESCE(thread_read."lastReadAt", room_read."createdAt", '-infinity'::timestamp))
  )`;
}

function sqlReadJoins(userSql: string): string {
  return `LEFT JOIN "chat_room_read_state" room_read
      ON room_read."roomId" = m."roomId" AND room_read."userId" = ${userSql}
    LEFT JOIN "chat_room_thread_read_state" thread_read
      ON thread_read."parentMessageId" = m."parentMessageId" AND thread_read."userId" = ${userSql}`;
}

/** SQL predicate: signal `s` asks something of the viewer `userSql`. */
function sqlNeedsViewer(userSql: string): string {
  return `(${userSql} = ANY(s."addressedUserIds")
    AND (${sqlChatSignalHasTag("s", "question")} OR ${sqlChatSignalHasTag("s", "needsDecision")}))`;
}

/**
 * Unread messages per room that ask something of the viewer: a question or
 * a decision addressed to them. Rooms with none are absent.
 */
export async function getChatRoomNeedsYouCounts(
  roomIds: readonly string[],
  userId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, number>> {
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return new Map();
  const user = `$${ids.length + 1}`;
  const rows = await client.$queryRawUnsafe<
    Array<{ roomId: string; count: number }>
  >(
    `SELECT m."roomId" AS "roomId", COUNT(*)::int AS count
    FROM "chat_message_signal" s
    INNER JOIN "chat_room_message" m ON m.id = s."messageId"
    ${sqlReadJoins(user)}
    WHERE s."roomId" IN (${placeholders(ids.length)})
      AND s.state = 'tagged'
      AND m."deletedAt" IS NULL
      AND (m."senderUserId" IS NULL OR m."senderUserId" <> ${user})
      AND ${sqlNeedsViewer(user)}
      AND ${sqlUnreadForViewer()}
    GROUP BY m."roomId"`,
    ...ids,
    userId,
  );
  return new Map(rows.map((row) => [row.roomId, Number(row.count)]));
}

export interface ChatCatchUp {
  /** Unread messages from others, tagged or not. */
  unreadCount: number;
  /** Unread messages Jev has read; the rest are too short or still waiting. */
  taggedCount: number;
  buckets: { bucket: ChatCatchUpBucket; count: number; messageIds: string[] }[];
}

/** What a room holds for the viewer since they last read it, by bucket. */
export async function getChatRoomCatchUp(
  roomId: string,
  userId: string,
): Promise<ChatCatchUp> {
  await requireChatRoomUserMembership(roomId, userId, prisma);
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; signalId: string | null }>
  >(
    `SELECT m.id, s.id AS "signalId"
    FROM "chat_room_message" m
    LEFT JOIN "chat_message_signal" s ON s."messageId" = m.id AND s.state = 'tagged'
    ${sqlReadJoins("$2")}
    WHERE m."roomId" = $1::uuid
      AND m."deletedAt" IS NULL
      AND m."parentMessageId" IS NULL
      AND (m."senderUserId" IS NULL OR m."senderUserId" <> $2)
      AND ${sqlUnreadForViewer()}
    ORDER BY m."createdAt" ASC`,
    roomId,
    userId,
  );
  const signals = await prisma.chatMessageSignal.findMany({
    where: {
      id: {
        in: rows.flatMap((row) => (row.signalId ? [row.signalId] : [])),
      },
    },
    select: { messageId: true, ...chatSignalSelect },
  });
  const byMessage = new Map(
    signals.map((signal) => [signal.messageId, signal]),
  );
  const buckets = new Map<ChatCatchUpBucket, string[]>();
  for (const row of rows) {
    const signal = byMessage.get(row.id);
    if (!signal) continue;
    const bucket = chatCatchUpBucket(
      storedChatSignalTags(signal),
      signal.addressedUserIds,
      userId,
    );
    if (bucket) buckets.set(bucket, [...(buckets.get(bucket) ?? []), row.id]);
  }
  return {
    unreadCount: rows.length,
    taggedCount: signals.length,
    buckets: CHAT_CATCH_UP_BUCKETS.flatMap((bucket) => {
      const messageIds = buckets.get(bucket);
      return messageIds
        ? [{ bucket, count: messageIds.length, messageIds }]
        : [];
    }),
  };
}

/** A room's messages that carry one tag, newest first, for a log view. */
export async function listChatRoomMessagesWithTag(
  roomId: string,
  userId: string,
  tag: ChatSignalTag,
  page: { cursor?: string; take: number },
) {
  await requireChatRoomUserMembership(roomId, userId, prisma);
  const cursorAt = page.cursor
    ? (
        await prisma.chatRoomMessage.findFirst({
          where: { id: page.cursor, roomId },
          select: { createdAt: true },
        })
      )?.createdAt
    : undefined;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; total: number }>
  >(
    `SELECT m.id, COUNT(*) OVER ()::int AS total
    FROM "chat_message_signal" s
    INNER JOIN "chat_room_message" m ON m.id = s."messageId"
    WHERE s."roomId" = $1::uuid
      AND s.state = 'tagged'
      AND m."deletedAt" IS NULL
      AND ${sqlChatSignalHasTag("s", tag)}
      ${cursorAt ? `AND m."createdAt" < $3` : ""}
    ORDER BY m."createdAt" DESC
    LIMIT $2`,
    roomId,
    page.take + 1,
    ...(cursorAt ? [cursorAt] : []),
  );
  const hasMore = rows.length > page.take;
  const ids = rows.slice(0, page.take).map((row) => row.id);
  const messages = await prisma.chatRoomMessage.findMany({
    where: { id: { in: ids } },
    include: chatRoomMessageInclude,
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  messages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return {
    messages,
    total: rows[0]?.total ?? 0,
    nextCursor: hasMore ? (ids.at(-1) ?? null) : null,
  };
}

/** The rooms a reader's cross-room lists read: what their sidebar lists, unmuted. */
async function readerRooms(userId: string, organizationId: string | null) {
  return prisma.chatRoom.findMany({
    where: {
      ...membershipVisibleActiveRoomWhere(userId, organizationId),
      userMembers: { some: { userId, mutedAt: null } },
    },
    select: { id: true, name: true, groupName: true, kind: true },
  });
}

export interface ChatSignalListItem {
  kind: ChatOpenLoopKind | "needsYou";
  room: { id: string; name: string; kind: string };
  message: Prisma.ChatRoomMessageGetPayload<{
    include: typeof chatRoomMessageInclude;
  }>;
  dueAt: Date | null;
}

async function loadListedMessages(ids: readonly string[]) {
  return prisma.chatRoomMessage.findMany({
    where: { id: { in: [...ids] } },
    include: chatRoomMessageInclude,
  });
}

/** Unread messages across the reader's rooms that ask something of them. */
export async function listChatNeedsYou(
  userId: string,
  organizationId: string | null,
): Promise<ChatSignalListItem[]> {
  const rooms = await readerRooms(userId, organizationId);
  if (rooms.length === 0) return [];
  const user = `$${rooms.length + 1}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT m.id
    FROM "chat_message_signal" s
    INNER JOIN "chat_room_message" m ON m.id = s."messageId"
    ${sqlReadJoins(user)}
    WHERE s."roomId" IN (${placeholders(rooms.length)})
      AND s.state = 'tagged'
      AND m."deletedAt" IS NULL
      AND (m."senderUserId" IS NULL OR m."senderUserId" <> ${user})
      AND ${sqlNeedsViewer(user)}
      AND ${sqlUnreadForViewer()}
    ORDER BY m."createdAt" DESC
    LIMIT ${MAX_LISTED}`,
    ...rooms.map((room) => room.id),
    userId,
  );
  const messages = await loadListedMessages(rows.map((row) => row.id));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return rows.flatMap((row) => {
    const message = messages.find((candidate) => candidate.id === row.id);
    const room = message && roomById.get(message.roomId);
    if (!message || !room) return [];
    return [
      {
        kind: "needsYou" as const,
        room: {
          id: room.id,
          name: room.groupName ?? room.name,
          kind: room.kind,
        },
        message,
        dueAt: null,
      },
    ];
  });
}

/**
 * The reader's open loops across their rooms: questions and decisions asked
 * of them that they have not answered after a few hours, and their own
 * commitments whose date has passed. Newest first.
 */
export async function listChatOpenLoops(
  userId: string,
  organizationId: string | null,
  now = new Date(),
): Promise<ChatSignalListItem[]> {
  const rooms = await readerRooms(userId, organizationId);
  if (rooms.length === 0) return [];
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const signals = await prisma.chatMessageSignal.findMany({
    where: {
      roomId: { in: rooms.map((room) => room.id) },
      state: "tagged",
      loopClosedAt: null,
      createdAt: { gte: since },
      message: { deletedAt: null },
      OR: [
        {
          addressedUserIds: { has: userId },
          message: {
            createdAt: {
              lte: new Date(now.getTime() - OPEN_QUESTION_AFTER_MS),
            },
          },
        },
        {
          message: { senderUserId: userId },
          commitmentDueAt: { lte: now },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: MAX_LISTED * 2,
    select: {
      messageId: true,
      ...chatSignalSelect,
      message: {
        select: {
          roomId: true,
          parentMessageId: true,
          senderUserId: true,
          createdAt: true,
        },
      },
    },
  });
  const loops: {
    messageId: string;
    kind: ChatOpenLoopKind;
    dueAt: Date | null;
  }[] = [];
  for (const signal of signals) {
    const { message } = signal;
    const viewerRepliedAfter =
      message.senderUserId !== userId &&
      (await prisma.chatRoomMessage.count({
        where: {
          roomId: message.roomId,
          senderUserId: userId,
          deletedAt: null,
          createdAt: { gt: message.createdAt },
          // An answer lands in the same conversation: the Thread the
          // question sits in, or the channel itself.
          ...(message.parentMessageId
            ? {
                OR: [
                  { parentMessageId: message.parentMessageId },
                  { id: message.parentMessageId },
                ],
              }
            : {
                OR: [
                  { parentMessageId: null },
                  { parentMessageId: signal.messageId },
                ],
              }),
        },
        take: 1,
      })) > 0;
    const kind = chatOpenLoopKind({
      signal,
      viewerId: userId,
      senderUserId: message.senderUserId,
      sentAt: message.createdAt,
      viewerRepliedAfter,
      now,
    });
    if (kind) {
      loops.push({
        messageId: signal.messageId,
        kind,
        dueAt: kind === "commitment" ? signal.commitmentDueAt : null,
      });
    }
    if (loops.length >= MAX_LISTED) break;
  }
  const messages = await loadListedMessages(
    loops.map((loop) => loop.messageId),
  );
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return loops.flatMap((loop) => {
    const message = messages.find(
      (candidate) => candidate.id === loop.messageId,
    );
    const room = message && roomById.get(message.roomId);
    if (!message || !room) return [];
    return [
      {
        kind: loop.kind,
        room: {
          id: room.id,
          name: room.groupName ?? room.name,
          kind: room.kind,
        },
        message,
        dueAt: loop.dueAt,
      },
    ];
  });
}

/** The signal of a message the viewer can read; 404 otherwise. */
async function requireReadableSignal(messageId: string, userId: string) {
  const signal = await prisma.chatMessageSignal.findUnique({
    where: { messageId },
    select: {
      id: true,
      roomId: true,
      state: true,
      message: { select: { deletedAt: true } },
    },
  });
  if (!signal || signal.message.deletedAt || signal.state !== "tagged") {
    throw notFound("This message has no signal");
  }
  await requireChatRoomUserMembership(signal.roomId, userId, prisma);
  return signal;
}

/**
 * A reader corrects one tag. The correction applies for every reader, and
 * Jev's own probability stays stored beside it.
 */
export async function correctChatMessageSignal(input: {
  messageId: string;
  userId: string;
  tag: ChatSignalTag;
  applies: boolean;
}): Promise<{ roomId: string }> {
  const signal = await requireReadableSignal(input.messageId, input.userId);
  await prisma.chatMessageSignalCorrection.upsert({
    where: {
      signalId_userId_tag: {
        signalId: signal.id,
        userId: input.userId,
        tag: input.tag,
      },
    },
    create: {
      signalId: signal.id,
      userId: input.userId,
      tag: input.tag,
      applies: input.applies,
    },
    update: { applies: input.applies },
  });
  return { roomId: signal.roomId };
}

/**
 * Closes or reopens a message's open loop: made into a Task, dismissed, or
 * brought back. A Task id must be one the viewer can see.
 */
export async function setChatMessageSignalLoop(input: {
  messageId: string;
  userId: string;
  workspaceId: string;
  closed: boolean;
  taskId?: string | null;
}): Promise<{ roomId: string }> {
  const signal = await requireReadableSignal(input.messageId, input.userId);
  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!task) throw notFound("Task not found");
  }
  await prisma.chatMessageSignal.update({
    where: { id: signal.id },
    data: input.closed
      ? { loopClosedAt: new Date(), loopTaskId: input.taskId ?? null }
      : { loopClosedAt: null, loopTaskId: null },
  });
  return { roomId: signal.roomId };
}
