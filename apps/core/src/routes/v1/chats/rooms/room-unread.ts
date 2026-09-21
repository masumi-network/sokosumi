import { NotificationKind, type Prisma } from "@sokosumi/database";

import { CHAT_ROOM_BADGE_MESSAGE_KEYS } from "@/helpers/notification-delivery";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  normalizeUniqueStrings,
} from "./helpers";

/**
 * A completed response becomes readable when its mention reaches responded.
 * Reading a Thought placeholder cannot consume an answer that arrives later.
 * Ordinary edits do not change the mention's terminal timestamp. Keep message
 * createdAt for timeline position and pagination. Aliases are code constants.
 */
export function sqlMessageAttentionAt(alias: "message" | "reply"): string {
  return `GREATEST(${alias}."createdAt", (
    SELECT response_mention."updatedAt"
    FROM "chat_room_mention" response_mention
    WHERE response_mention."responseMessageId" = ${alias}.id
      AND response_mention.status = 'responded'
  ))`;
}

/**
 * SQL predicate: viewer is a Participant of `parent` (ADR-0013).
 * Parent author, remaining own reply, or remaining user mention on parent/reply.
 */
function sqlViewerIsThreadParticipant(userIdSql: string): string {
  return `(
    parent."senderUserId" = ${userIdSql}
    OR EXISTS (
      SELECT 1
      FROM "chat_room_message" own_reply
      WHERE own_reply."parentMessageId" = parent.id
        AND own_reply."roomId" = parent."roomId"
        AND own_reply."senderUserId" = ${userIdSql}
        AND own_reply."deletedAt" IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM "chat_room_user_mention" um
      INNER JOIN "chat_room_message" um_msg
        ON um_msg.id = um."messageId"
      WHERE um."userId" = ${userIdSql}
        AND um_msg."deletedAt" IS NULL
        AND um_msg."roomId" = parent."roomId"
        AND (
          um_msg.id = parent.id
          OR um_msg."parentMessageId" = parent.id
        )
    )
  )`;
}

/**
 * SQL predicate: this `reply` pages the viewer.
 *
 * The viewer Participates in `parent` and has not muted that Thread, or they
 * are named on this reply. A user mention breaks through mute: muting a
 * Thread silences its chatter, and being addressed by name is not chatter.
 * Mute never changes Participant, so unmuting restores the Thread to exactly
 * the attention it would have had.
 *
 * Requires the `thread_read` and `reply` aliases, which every caller joins
 * for the look baseline.
 */
function sqlThreadReplyPagesViewer(userIdSql: string): string {
  return `(
    (
      thread_read."mutedAt" IS NULL
      AND ${sqlViewerIsThreadParticipant(userIdSql)}
    )
    OR EXISTS (
      SELECT 1
      FROM "chat_room_user_mention" reply_mention
      WHERE reply_mention."userId" = ${userIdSql}
        AND reply_mention."messageId" = reply.id
    )
  )`;
}

/**
 * A room's unread, as its two addends: Room unread and Thread unread
 * (ADR-0037).
 *
 * `channel` is what Room last-read clears. `thread` is what Looking a Thread
 * clears. They are reported separately because a reader who clears a channel
 * must see its mark go quiet, and folding the two made that impossible.
 * `total` is the sum, which is what `unreadCount` has always meant on the wire.
 */
export interface ChatRoomUnreadBreakdown {
  channel: number;
  thread: number;
  total: number;
}

export function emptyChatRoomUnreadBreakdown(): ChatRoomUnreadBreakdown {
  return { channel: 0, thread: 0, total: 0 };
}

/**
 * The three unread fields a room summary carries, from one breakdown.
 *
 * `unreadCount` stays the total so existing clients keep their meaning; the
 * two halves are additive (ADR-0037). A room with nothing unread is absent
 * from the map, and reads as zero in all three. One helper so the routes that
 * build a summary cannot drift from each other.
 */
export function unreadCountFields(
  breakdown: ChatRoomUnreadBreakdown | undefined,
): {
  unreadCount: number;
  channelUnreadCount: number;
  threadUnreadCount: number;
} {
  const { channel, thread, total } =
    breakdown ?? emptyChatRoomUnreadBreakdown();
  return {
    unreadCount: total,
    channelUnreadCount: channel,
    threadUnreadCount: thread,
  };
}

/**
 * Per-room unread message counts for sidebar attention, one per leg.
 *
 * Dual baseline (matches the two read-state tables):
 * - Top-level messages (`parentMessageId IS NULL`): after room `lastReadAt`
 * - Thread replies: after per-thread look baseline
 *   (`ChatRoomThreadReadState.lastReadAt`, else room read-state `createdAt`,
 *   else -infinity), and only when that reply pages the viewer: they
 *   Participate in the Thread and have not muted it (ADR-0013, ADR-0030), or
 *   they are named on the reply. Room mark-read must not clear thread look
 *   contribution; looking a thread must.
 *
 * Soft-deleted messages and the viewer's own user messages are excluded.
 */
export async function getChatRoomUnreadCounts(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, ChatRoomUnreadBreakdown>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const roomIdPlaceholders = uniqueRoomIds
    .map((_, index) => `$${index + 1}::uuid`)
    .join(", ");
  const userIdPlaceholder = `$${uniqueRoomIds.length + 1}`;

  const rows = await tx.$queryRawUnsafe<
    Array<{
      roomId: string;
      source: "channel" | "thread";
      unreadCount: number | bigint;
    }>
  >(
    `
    SELECT
      combined."roomId" AS "roomId",
      combined.source AS "source",
      COUNT(*)::int AS "unreadCount"
    FROM (
      SELECT message.id, message."roomId", 'channel'::text AS source
      FROM "chat_room_message" message
      LEFT JOIN "chat_room_read_state" read_state
        ON read_state."roomId" = message."roomId"
        AND read_state."userId" = ${userIdPlaceholder}
      WHERE message."roomId" IN (${roomIdPlaceholders})
        AND message."parentMessageId" IS NULL
        AND message."deletedAt" IS NULL
        AND ${sqlMessageAttentionAt("message")} > COALESCE(read_state."lastReadAt", '-infinity'::timestamp)
        AND (message."senderUserId" IS NULL OR message."senderUserId" <> ${userIdPlaceholder})

      UNION ALL

      SELECT reply.id, reply."roomId", 'thread'::text AS source
      FROM "chat_room_message" reply
      INNER JOIN "chat_room_message" parent
        ON parent.id = reply."parentMessageId"
        AND parent."roomId" = reply."roomId"
      LEFT JOIN "chat_room_thread_read_state" thread_read
        ON thread_read."parentMessageId" = parent.id
        AND thread_read."userId" = ${userIdPlaceholder}
      LEFT JOIN "chat_room_read_state" room_read
        ON room_read."roomId" = reply."roomId"
        AND room_read."userId" = ${userIdPlaceholder}
      WHERE reply."roomId" IN (${roomIdPlaceholders})
        AND reply."parentMessageId" IS NOT NULL
        AND reply."deletedAt" IS NULL
        AND parent."deletedAt" IS NULL
        AND parent."parentMessageId" IS NULL
        AND ${sqlThreadReplyPagesViewer(userIdPlaceholder)}
        AND ${sqlMessageAttentionAt("reply")} > COALESCE(
          thread_read."lastReadAt",
          room_read."createdAt",
          '-infinity'::timestamp
        )
        AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> ${userIdPlaceholder})
    ) combined
    GROUP BY combined."roomId", combined.source
  `,
    ...uniqueRoomIds,
    userId,
  );

  const byRoom = new Map<string, ChatRoomUnreadBreakdown>();
  for (const row of rows) {
    const breakdown = byRoom.get(row.roomId) ?? emptyChatRoomUnreadBreakdown();
    if (row.source === "channel") {
      breakdown.channel = Number(row.unreadCount);
    } else {
      breakdown.thread = Number(row.unreadCount);
    }
    breakdown.total = breakdown.channel + breakdown.thread;
    byRoom.set(row.roomId, breakdown);
  }
  return byRoom;
}

export interface ChatRoomThreadAggregate {
  parentMessageId: string;
  replyCount: number;
  lastReplyAt: Date;
  unreadReplyCount: number;
  lastUnreadReplyAt: Date | null;
  /** True when the viewer has a ChatRoomThreadReadState row for this parent. */
  hasLooked: boolean;
  /** When the viewer muted this thread, or null when they have not. */
  mutedAt: Date | null;
}

/**
 * Parents (top-level messages) in a room that have ≥1 non-deleted reply,
 * with per-user unread counts.
 *
 * `unreadReplyCount` is Participant-gated (ADR-0013) and mute-gated
 * (ADR-0030): non-self replies after dual-baseline look (thread lastReadAt,
 * else room join createdAt, else -infinity). Never-looked Participants can be
 * > 0. Lurkers are 0. A muted Thread is 0 apart from replies that name the
 * viewer. `unreadOnly` filters on `unreadReplyCount >= 1`.
 */
export async function getChatRoomThreadAggregates(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
  options?: {
    unreadOnly?: boolean;
    parentMessageId?: string;
    recency?: { cursor?: string; limit: number };
  },
): Promise<ChatRoomThreadAggregate[]> {
  const unreadOnly = options?.unreadOnly === true;
  const parentMessageId = options?.parentMessageId;
  const recency = options?.recency;
  const innerSelect = `
    SELECT
      parent.id AS "parentMessageId",
      COUNT(reply.id)::int AS "replyCount",
      MAX(reply."createdAt") AS "lastReplyAt",
      COUNT(reply.id) FILTER (
        WHERE ${sqlThreadReplyPagesViewer("$2")}
          AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> $2)
          AND ${sqlMessageAttentionAt("reply")} > COALESCE(
            thread_read."lastReadAt",
            room_read."createdAt",
            '-infinity'::timestamp
          )
      )::int AS "unreadReplyCount",
      MAX(${sqlMessageAttentionAt("reply")}) FILTER (
        WHERE ${sqlThreadReplyPagesViewer("$2")}
          AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> $2)
          AND ${sqlMessageAttentionAt("reply")} > COALESCE(
            thread_read."lastReadAt",
            room_read."createdAt",
            '-infinity'::timestamp
          )
      ) AS "lastUnreadReplyAt",
      (MAX(thread_read."lastReadAt") IS NOT NULL) AS "hasLooked",
      MAX(thread_read."mutedAt") AS "mutedAt"
    FROM "chat_room_message" reply
    INNER JOIN "chat_room_message" parent
      ON parent.id = reply."parentMessageId"
      AND parent."roomId" = reply."roomId"
    LEFT JOIN "chat_room_thread_read_state" thread_read
      ON thread_read."parentMessageId" = parent.id
      AND thread_read."userId" = $2
    LEFT JOIN "chat_room_read_state" room_read
      ON room_read."roomId" = reply."roomId"
      AND room_read."userId" = $2
    WHERE reply."roomId" = $1::uuid
      AND reply."parentMessageId" IS NOT NULL
      AND reply."deletedAt" IS NULL
      AND parent."deletedAt" IS NULL
      AND parent."parentMessageId" IS NULL
      ${parentMessageId ? "AND parent.id = $3::uuid" : ""}
    GROUP BY parent.id
    HAVING COUNT(reply.id) >= 1
  `;

  // Recency cursor baseline must be pure scalar subqueries. Joining parent to
  // replies then selecting MAX(...) + p.createdAt without GROUP BY is Postgres
  // 42803 (SOKOSUMI-CORE-32) — every GET …/threads?limit=… 500s in prod.
  const recencyCursorFilter = recency?.cursor
    ? `
      AND ("lastReplyAt", "parentMessageId") < (
        SELECT COALESCE(
          (
            SELECT MAX(r."createdAt")
            FROM "chat_room_message" r
            WHERE r."parentMessageId" = $3::uuid
              AND r."deletedAt" IS NULL
              AND r."roomId" = $1::uuid
          ),
          (
            SELECT p."createdAt"
            FROM "chat_room_message" p
            WHERE p.id = $3::uuid
              AND p."roomId" = $1::uuid
          )
        ),
        $3::uuid
      )
    `
    : "";

  const recencySql = recency
    ? `
    SELECT * FROM (${innerSelect}) threads
    WHERE "unreadReplyCount" = 0
    ${recencyCursorFilter}
    ORDER BY "lastReplyAt" DESC, "parentMessageId" DESC
    LIMIT $${recency.cursor ? 4 : 3}
    `
    : unreadOnly
      ? `
    SELECT * FROM (${innerSelect}) threads
    WHERE "unreadReplyCount" >= 1
    ORDER BY "lastReplyAt" DESC, "parentMessageId" DESC
    `
      : `
    ${innerSelect}
    ORDER BY MAX(reply."createdAt") DESC
    `;

  const queryArgs = recency
    ? recency.cursor
      ? [roomId, userId, recency.cursor, recency.limit + 1]
      : [roomId, userId, recency.limit + 1]
    : parentMessageId
      ? [roomId, userId, parentMessageId]
      : [roomId, userId];

  const rows = await tx.$queryRawUnsafe<
    Array<{
      parentMessageId: string;
      replyCount: number | bigint;
      lastReplyAt: Date;
      unreadReplyCount: number | bigint;
      lastUnreadReplyAt: Date | null;
      hasLooked: boolean;
      mutedAt: Date | null;
    }>
  >(recencySql, ...queryArgs);

  return rows.map((row) => ({
    parentMessageId: row.parentMessageId,
    replyCount: Number(row.replyCount),
    lastReplyAt: row.lastReplyAt,
    unreadReplyCount: Number(row.unreadReplyCount),
    lastUnreadReplyAt: row.lastUnreadReplyAt,
    hasLooked: row.hasLooked === true,
    mutedAt: row.mutedAt,
  }));
}

async function mapThreadAggregates(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
  aggregates: ChatRoomThreadAggregate[],
) {
  if (aggregates.length === 0) {
    return [];
  }

  const parents = await tx.chatRoomMessage.findMany({
    where: {
      id: { in: aggregates.map((row) => row.parentMessageId) },
      roomId,
      parentMessageId: null,
      deletedAt: null,
    },
    include: chatRoomMessageInclude,
  });
  const parentsById = new Map(parents.map((parent) => [parent.id, parent]));

  return aggregates.flatMap((aggregate) => {
    const parent = parentsById.get(aggregate.parentMessageId);
    if (!parent) {
      return [];
    }
    return [
      {
        parentMessage: mapChatRoomMessage(parent, userId),
        replyCount: aggregate.replyCount,
        lastReplyAt: aggregate.lastReplyAt,
        unreadReplyCount: aggregate.unreadReplyCount,
        lastUnreadReplyAt: aggregate.lastUnreadReplyAt,
        hasLooked: aggregate.hasLooked,
        mutedAt: aggregate.mutedAt,
      },
    ];
  });
}

/**
 * List threads in a room. When `unreadOnly`, only parents with
 * `unreadReplyCount >= 1` (Participant-gated dual-baseline).
 */
export async function listChatRoomThreads(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
  options?: { unreadOnly?: boolean },
) {
  const aggregates = await getChatRoomThreadAggregates(roomId, userId, tx, {
    unreadOnly: options?.unreadOnly,
  });
  return mapThreadAggregates(roomId, userId, tx, aggregates);
}

export interface ChatRoomThreadListPage {
  items: Awaited<ReturnType<typeof mapThreadAggregates>>;
  nextCursor: string | null;
  total: number;
}

/**
 * Full room thread list: unread threads first (unreadReplyCount >= 1), then a
 * recency page of the rest. Cursor pages are recency-only.
 */
export async function listChatRoomThreadListPage(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
  options: { cursor?: string; limit: number },
): Promise<ChatRoomThreadListPage> {
  const { cursor, limit } = options;

  const unreadAggregates = cursor
    ? []
    : await getChatRoomThreadAggregates(roomId, userId, tx, {
        unreadOnly: true,
      });

  const recencyPlus = await getChatRoomThreadAggregates(roomId, userId, tx, {
    recency: { cursor, limit },
  });
  const hasMore = recencyPlus.length > limit;
  const recencyAggregates = recencyPlus.slice(0, limit);

  const countRows = await tx.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `
    SELECT COUNT(*)::int AS count FROM (
      SELECT parent.id
      FROM "chat_room_message" reply
      INNER JOIN "chat_room_message" parent
        ON parent.id = reply."parentMessageId"
        AND parent."roomId" = reply."roomId"
      WHERE reply."roomId" = $1::uuid
        AND reply."parentMessageId" IS NOT NULL
        AND reply."deletedAt" IS NULL
        AND parent."deletedAt" IS NULL
        AND parent."parentMessageId" IS NULL
      GROUP BY parent.id
      HAVING COUNT(reply.id) >= 1
    ) threads
    `,
    roomId,
  );

  const items = await mapThreadAggregates(roomId, userId, tx, [
    ...unreadAggregates,
    ...recencyAggregates,
  ]);

  return {
    items,
    nextCursor: hasMore
      ? (recencyAggregates[recencyAggregates.length - 1]?.parentMessageId ??
        null)
      : null,
    total: Number(countRows[0]?.count ?? 0),
  };
}

/**
 * One thread summary by parent id, or null when missing / not a thread.
 */
export async function getChatRoomThread(
  roomId: string,
  userId: string,
  parentMessageId: string,
  tx: Prisma.TransactionClient,
) {
  const aggregates = await getChatRoomThreadAggregates(roomId, userId, tx, {
    parentMessageId,
  });
  const items = await mapThreadAggregates(roomId, userId, tx, aggregates);
  return items[0] ?? null;
}

/**
 * Upsert look state for a top-level parent. Returns null when parent missing.
 */
export async function markChatRoomThreadRead(
  roomId: string,
  userId: string,
  parentMessageId: string,
  tx: Prisma.TransactionClient,
  readAt: Date = new Date(),
): Promise<{ parentMessageId: string; lastReadAt: Date } | null> {
  const parent = await tx.chatRoomMessage.findFirst({
    where: {
      id: parentMessageId,
      roomId,
      parentMessageId: null,
    },
    select: { id: true },
  });
  if (!parent) {
    return null;
  }
  const state = await tx.chatRoomThreadReadState.upsert({
    where: {
      userId_parentMessageId: {
        userId,
        parentMessageId: parent.id,
      },
    },
    update: { lastReadAt: readAt },
    create: {
      userId,
      parentMessageId: parent.id,
      lastReadAt: readAt,
    },
  });

  return {
    parentMessageId: state.parentMessageId,
    lastReadAt: state.lastReadAt,
  };
}

/**
 * Did a reply name the reader while the thread was muted?
 *
 * Mute lets a user mention through (ADR-0030), so such a reply was never
 * silenced: it counted and it notified. Unmute must not step over it.
 *
 * Compares `createdAt`, while the unread predicate compares attention time
 * (a responded coworker mention can raise that). The two agree for every
 * message that can carry a user mention, because only a user-authored
 * message does, and attention is raised only on agent responses.
 */
async function threadNamedReaderSinceLook(
  tx: Prisma.TransactionClient,
  userId: string,
  parentMessageId: string,
  lastReadAt: Date,
): Promise<boolean> {
  const naming = await tx.chatRoomMessage.findFirst({
    where: {
      parentMessageId,
      deletedAt: null,
      createdAt: { gt: lastReadAt },
      userMentionsAsSource: { some: { userId } },
    },
    select: { id: true },
  });

  return naming !== null;
}

/**
 * Mute or unmute one thread for one user. Returns null when the parent is not
 * a live top-level message in this room.
 *
 * Muting Looks the thread, so it takes the replies already waiting with it.
 * Unmuting Looks it too, so paging starts from now rather than replaying the
 * stretch that was deliberately silenced. Repeating either direction changes
 * nothing, which is what keeps a reply that named the reader after the first
 * mute: it broke through on purpose, and a second Look would step over it.
 *
 * A parent with no live reply is not a Thread, in either direction: there is
 * nothing to page anyone, and the read-back the routes answer with would find
 * no thread either.
 */
export async function setChatRoomThreadMuted(
  roomId: string,
  userId: string,
  parentMessageId: string,
  muted: boolean,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<{ parentMessageId: string; mutedAt: Date | null } | null> {
  const parent = await tx.chatRoomMessage.findFirst({
    where: {
      id: parentMessageId,
      roomId,
      parentMessageId: null,
      deletedAt: null,
      replies: { some: { deletedAt: null } },
    },
    select: { id: true },
  });
  if (!parent) {
    return null;
  }

  const existing = await tx.chatRoomThreadReadState.findUnique({
    where: { userId_parentMessageId: { userId, parentMessageId: parent.id } },
    select: { lastReadAt: true, mutedAt: true },
  });

  if (muted) {
    // Muting an already muted thread changes nothing. Advancing the look
    // again would step over a reply that named the reader in the meantime,
    // and that reply broke through the mute on purpose.
    if (existing?.mutedAt) {
      return { parentMessageId: parent.id, mutedAt: existing.mutedAt };
    }

    const state = await tx.chatRoomThreadReadState.upsert({
      where: { userId_parentMessageId: { userId, parentMessageId: parent.id } },
      update: { mutedAt: now, lastReadAt: now },
      create: {
        userId,
        parentMessageId: parent.id,
        mutedAt: now,
        lastReadAt: now,
      },
    });

    return { parentMessageId: state.parentMessageId, mutedAt: state.mutedAt };
  }

  // Unmuting a thread that was not muted writes nothing: there is no silenced
  // stretch to step over, and advancing the look would eat real unread.
  if (existing?.mutedAt) {
    const named = await threadNamedReaderSinceLook(
      tx,
      userId,
      parent.id,
      existing.lastReadAt,
    );
    await tx.chatRoomThreadReadState.update({
      where: { userId_parentMessageId: { userId, parentMessageId: parent.id } },
      // Leave the look where mute put it when the thread named the reader
      // while it was muted: that reply is unread, and a high-water mark
      // cannot clear the chatter around it without clearing it too.
      data: named ? { mutedAt: null } : { mutedAt: null, lastReadAt: now },
    });
  }

  return { parentMessageId: parent.id, mutedAt: null };
}

/**
 * Count parents with `unreadReplyCount >= 1` (Participant-gated dual-baseline,
 * including mentions in muted Threads). No parent hydrate or row list.
 * Same eligibility as `unreadOnly` (ADR-0013, ADR-0030).
 */
export async function countChatRoomUnreadThreads(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `
    SELECT COUNT(DISTINCT parent.id)::int AS count
    FROM "chat_room_message" reply
    INNER JOIN "chat_room_message" parent
      ON parent.id = reply."parentMessageId"
      AND parent."roomId" = reply."roomId"
    LEFT JOIN "chat_room_thread_read_state" thread_read
      ON thread_read."parentMessageId" = parent.id
      AND thread_read."userId" = $2
    LEFT JOIN "chat_room_read_state" room_read
      ON room_read."roomId" = reply."roomId"
      AND room_read."userId" = $2
    WHERE reply."roomId" = $1::uuid
      AND reply."parentMessageId" IS NOT NULL
      AND reply."deletedAt" IS NULL
      AND parent."deletedAt" IS NULL
      AND parent."parentMessageId" IS NULL
      AND ${sqlThreadReplyPagesViewer("$2")}
      AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> $2)
      AND ${sqlMessageAttentionAt("reply")} > COALESCE(
        thread_read."lastReadAt",
        room_read."createdAt",
        '-infinity'::timestamp
      )
    `,
    roomId,
    userId,
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Upsert look state for every unread Thread the viewer Participates in and
 * has not muted. Does not change room ChatRoomReadState or CHAT notifications.
 * Muted Threads stay untouched even when a mention is unread (SOK-1087).
 */
export async function markAllChatRoomThreadsRead(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const parents = await tx.$queryRawUnsafe<Array<{ parentMessageId: string }>>(
    `
    SELECT DISTINCT parent.id AS "parentMessageId"
    FROM "chat_room_message" reply
    INNER JOIN "chat_room_message" parent
      ON parent.id = reply."parentMessageId"
      AND parent."roomId" = reply."roomId"
    LEFT JOIN "chat_room_thread_read_state" thread_read
      ON thread_read."parentMessageId" = parent.id
      AND thread_read."userId" = $2
    LEFT JOIN "chat_room_read_state" room_read
      ON room_read."roomId" = reply."roomId"
      AND room_read."userId" = $2
    WHERE reply."roomId" = $1::uuid
      AND reply."parentMessageId" IS NOT NULL
      AND reply."deletedAt" IS NULL
      AND parent."deletedAt" IS NULL
      AND parent."parentMessageId" IS NULL
      AND thread_read."mutedAt" IS NULL AND ${sqlViewerIsThreadParticipant("$2")}
      AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> $2)
      AND ${sqlMessageAttentionAt("reply")} > COALESCE(
        thread_read."lastReadAt",
        room_read."createdAt",
        '-infinity'::timestamp
      )
    `,
    roomId,
    userId,
  );
  if (parents.length === 0) {
    return 0;
  }

  const readAt = new Date();
  for (const parent of parents) {
    await tx.chatRoomThreadReadState.upsert({
      where: {
        userId_parentMessageId: {
          userId,
          parentMessageId: parent.parentMessageId,
        },
      },
      update: { lastReadAt: readAt },
      create: {
        userId,
        parentMessageId: parent.parentMessageId,
        lastReadAt: readAt,
      },
    });
  }

  return parents.length;
}

/**
 * Per-room count of the unread chat notifications a badge is for.
 *
 * `referenceId` is the room id, and every chat notification carries the same
 * `NotificationKind.CHAT`, so the message key is the only thing that says which
 * of them was addressed to the reader. `CHAT_ROOM_BADGE_MESSAGE_KEYS` is that
 * list. Counting the kind alone made a badge out of every message in a room the
 * moment `CHAT_ROOM_MESSAGE` gave rooms a third notification.
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

  return new Map(
    groups.map((group) => [group.referenceId, group._count._all] as const),
  );
}
