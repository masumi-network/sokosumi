import { NotificationKind, type Prisma } from "@sokosumi/database";

import { CHAT_ROOM_BADGE_MESSAGE_KEYS } from "@/helpers/notification-delivery";
import {
  CHAT_ROOM_UNREAD_THREAD_CAP,
  CHAT_ROOM_UNREAD_THREAD_CONTENT_CHARS,
} from "@/schemas/chat-room.schema";

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

/** `$1::uuid, …, $n::uuid`: the room ids lead every multi-room query. */
function sqlRoomIdPlaceholders(count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `$${index + 1}::uuid`,
  ).join(", ");
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
 * SQL `FROM … WHERE` for every reply that is Thread unread to the viewer.
 *
 * One fragment for the room's Thread unread number and for the lists of
 * unread Threads, the sidebar's and the Threads view's, so a Thread can never
 * be listed while contributing nothing to the number, or the reverse
 * (ADR-0037). Exposes the `reply`, `parent`, `thread_read` and `room_read`
 * aliases.
 */
function sqlUnreadThreadReplies(
  roomIdPlaceholders: string,
  userIdSql: string,
): string {
  return `FROM "chat_room_message" reply
      INNER JOIN "chat_room_message" parent
        ON parent.id = reply."parentMessageId"
        AND parent."roomId" = reply."roomId"
      LEFT JOIN "chat_room_thread_read_state" thread_read
        ON thread_read."parentMessageId" = parent.id
        AND thread_read."userId" = ${userIdSql}
      LEFT JOIN "chat_room_read_state" room_read
        ON room_read."roomId" = reply."roomId"
        AND room_read."userId" = ${userIdSql}
      WHERE reply."roomId" IN (${roomIdPlaceholders})
        AND reply."parentMessageId" IS NOT NULL
        AND reply."deletedAt" IS NULL
        AND parent."deletedAt" IS NULL
        AND parent."parentMessageId" IS NULL
        AND ${sqlThreadReplyPagesViewer(userIdSql)}
        AND ${sqlMessageAttentionAt("reply")} > COALESCE(
          thread_read."lastReadAt",
          room_read."createdAt",
          '-infinity'::timestamp
        )
        AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> ${userIdSql})`;
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

  const roomIdPlaceholders = sqlRoomIdPlaceholders(uniqueRoomIds.length);
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
        -- A Group name change has no sender, so it would be unread even for
        -- whoever made it; a rename never marks the room unread.
        AND message."metadata"->'groupNameChange' IS NULL
        AND ${sqlMessageAttentionAt("message")} > COALESCE(read_state."lastReadAt", '-infinity'::timestamp)
        AND (message."senderUserId" IS NULL OR message."senderUserId" <> ${userIdPlaceholder})

      UNION ALL

      SELECT reply.id, reply."roomId", 'thread'::text AS source
      ${sqlUnreadThreadReplies(roomIdPlaceholders, userIdPlaceholder)}
    ) combined
    GROUP BY combined."roomId", combined.source
  `,
    ...uniqueRoomIds,
    userId,
  );

  const byRoom = new Map<string, ChatRoomUnreadBreakdown>();
  for (const row of rows) {
    const breakdown = byRoom.get(row.roomId) ?? emptyChatRoomUnreadBreakdown();
    // The source literals are the breakdown's own keys, so a leg can only
    // land in its own half.
    breakdown[row.source] = Number(row.unreadCount);
    breakdown.total = breakdown.channel + breakdown.thread;
    byRoom.set(row.roomId, breakdown);
  }
  return byRoom;
}

export interface ChatRoomUnreadThreadPreview {
  parentMessageId: string;
  /** Where opening the Thread lands: the oldest reply still unread. */
  firstUnreadReplyId: string;
  /** The parent's raw content, cut short. The client builds the label. */
  parentContent: string;
  unreadReplyCount: number;
  /** How many of those unread replies name the viewer. */
  unreadMentionCount: number;
  /** When the newest unread reply came: what the list ranks by. */
  lastUnreadAt: Date;
}

export interface ChatRoomUnreadThreads {
  /** Newest unread reply first, at most `CHAT_ROOM_UNREAD_THREAD_CAP`. */
  threads: ChatRoomUnreadThreadPreview[];
  /** Every unread Thread in the room, so the overflow can state the rest. */
  unreadThreadCount: number;
  /**
   * Unread replies naming the viewer across every unread Thread in the room,
   * past the cap too, so a mention in a Thread the list leaves out still
   * reaches the Threads entry's pill.
   */
  unreadThreadMentionCount: number;
}

export function emptyChatRoomUnreadThreads(): ChatRoomUnreadThreads {
  return { threads: [], unreadThreadCount: 0, unreadThreadMentionCount: 0 };
}

/**
 * SQL `SELECT` of one row per unread Thread in the given rooms, grouped from
 * `sqlUnreadThreadReplies`: where opening it lands, its parent's content, how
 * many replies are unread and how many name the viewer, and `lastUnreadAt`
 * to rank by. The sidebar's per-room list and the cross-room list both read
 * it, so neither can list a Thread the other leaves out.
 */
function sqlUnreadThreadsByParent(
  roomIdPlaceholders: string,
  userIdSql: string,
): string {
  const attentionAt = sqlMessageAttentionAt("reply");
  return `SELECT
        parent."roomId" AS "roomId",
        parent.id AS "parentMessageId",
        (ARRAY_AGG(reply.id ORDER BY ${attentionAt} ASC, reply.id ASC))[1]
          AS "firstUnreadReplyId",
        LEFT(parent.content, ${CHAT_ROOM_UNREAD_THREAD_CONTENT_CHARS})
          AS "parentContent",
        COUNT(*)::int AS "unreadReplyCount",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "chat_room_user_mention" named
            WHERE named."userId" = ${userIdSql}
              AND named."messageId" = reply.id
          )
        )::int AS "unreadMentionCount",
        MAX(${attentionAt}) AS "lastUnreadAt"
      ${sqlUnreadThreadReplies(roomIdPlaceholders, userIdSql)}
      -- parent.id is the primary key, so its other columns ride along.
      GROUP BY parent.id`;
}

interface UnreadThreadRow {
  roomId: string;
  parentMessageId: string;
  firstUnreadReplyId: string;
  parentContent: string;
  unreadReplyCount: number | bigint;
  unreadMentionCount: number | bigint | null;
  lastUnreadAt: Date;
}

function mapUnreadThreadRow(row: UnreadThreadRow): ChatRoomUnreadThreadPreview {
  return {
    parentMessageId: row.parentMessageId,
    firstUnreadReplyId: row.firstUnreadReplyId,
    parentContent: row.parentContent,
    unreadReplyCount: Number(row.unreadReplyCount),
    unreadMentionCount: Number(row.unreadMentionCount ?? 0),
    lastUnreadAt: row.lastUnreadAt,
  };
}

/**
 * The top unread Threads per room, for the sidebar's inset rows.
 *
 * Ranked by newest unread reply and capped per room. Eligibility is
 * `sqlUnreadThreadReplies`, the same fragment the Thread unread number counts.
 */
export async function listChatRoomUnreadThreads(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, ChatRoomUnreadThreads>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const roomIdPlaceholders = sqlRoomIdPlaceholders(uniqueRoomIds.length);
  const userIdPlaceholder = `$${uniqueRoomIds.length + 1}`;

  const rows = await tx.$queryRawUnsafe<
    Array<
      UnreadThreadRow & {
        unreadThreadCount: number | bigint;
        unreadThreadMentionCount: number | bigint;
      }
    >
  >(
    `
    WITH unread AS (
      ${sqlUnreadThreadsByParent(roomIdPlaceholders, userIdPlaceholder)}
    ),
    ranked AS (
      SELECT
        unread.*,
        COUNT(*) OVER (PARTITION BY unread."roomId")::int
          AS "unreadThreadCount",
        SUM(unread."unreadMentionCount") OVER (PARTITION BY unread."roomId")::int
          AS "unreadThreadMentionCount",
        ROW_NUMBER() OVER (
          PARTITION BY unread."roomId"
          ORDER BY unread."lastUnreadAt" DESC, unread."parentMessageId" DESC
        ) AS rank
      FROM unread
    )
    SELECT
      "roomId",
      "parentMessageId",
      "firstUnreadReplyId",
      "parentContent",
      "unreadReplyCount",
      "unreadMentionCount",
      "lastUnreadAt",
      "unreadThreadCount",
      "unreadThreadMentionCount"
    FROM ranked
    WHERE rank <= ${CHAT_ROOM_UNREAD_THREAD_CAP}
    ORDER BY "roomId", rank
  `,
    ...uniqueRoomIds,
    userId,
  );

  const byRoom = new Map<string, ChatRoomUnreadThreads>();
  for (const row of rows) {
    const entry = byRoom.get(row.roomId) ?? emptyChatRoomUnreadThreads();
    entry.unreadThreadCount = Number(row.unreadThreadCount);
    entry.unreadThreadMentionCount = Number(row.unreadThreadMentionCount ?? 0);
    entry.threads.push(mapUnreadThreadRow(row));
    byRoom.set(row.roomId, entry);
  }
  return byRoom;
}

/** An unread Thread with the room it is in, for the cross-room list. */
export interface UnreadThreadInRoom extends ChatRoomUnreadThreadPreview {
  roomId: string;
}

export interface ChatUnreadThreadsPage {
  /** Newest unread reply first. */
  threads: UnreadThreadInRoom[];
  /** The last Thread's parent id when more follow, else null. */
  nextCursor: string | null;
  /** Every unread Thread across the rooms, not only this page. */
  total: number;
}

/**
 * The reader's unread Threads across rooms, one page, for the Threads view
 * (SOK-1159).
 *
 * The same rows the sidebar lists per room, uncapped and ranked across rooms
 * by newest unread reply. The cursor is a parent id and pages by its place in
 * that ranking. A cursor Thread that was read since has no place left, and the
 * page after it comes back empty, with the total still stated; the view reads
 * again from the top whenever the counts move, so that end is never the last
 * word.
 */
export async function listUnreadThreadsAcrossRooms(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
  options: { cursor?: string; limit: number },
): Promise<ChatUnreadThreadsPage> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return { threads: [], nextCursor: null, total: 0 };
  }

  const { cursor, limit } = options;
  const roomIdPlaceholders = sqlRoomIdPlaceholders(uniqueRoomIds.length);
  const userIdPlaceholder = `$${uniqueRoomIds.length + 1}`;
  const limitPlaceholder = `$${uniqueRoomIds.length + 2}`;
  const cursorPlaceholder = `$${uniqueRoomIds.length + 3}::uuid`;

  // The total rides a one-row count joined to the page, so an empty page
  // still says how many Threads are unread; that row's page columns are null.
  const rows = await tx.$queryRawUnsafe<
    Array<
      | (UnreadThreadRow & { totalThreadCount: number | bigint })
      | { parentMessageId: null; totalThreadCount: number | bigint }
    >
  >(
    `
    WITH unread AS (
      ${sqlUnreadThreadsByParent(roomIdPlaceholders, userIdPlaceholder)}
    ),
    page AS (
      SELECT unread.*
      FROM unread
      ${
        cursor
          ? `WHERE ("lastUnreadAt", "parentMessageId") < (
        SELECT cursor_thread."lastUnreadAt", cursor_thread."parentMessageId"
        FROM unread cursor_thread
        WHERE cursor_thread."parentMessageId" = ${cursorPlaceholder}
      )`
          : ""
      }
      ORDER BY "lastUnreadAt" DESC, "parentMessageId" DESC
      LIMIT ${limitPlaceholder}
    )
    SELECT page.*, totals."totalThreadCount"
    FROM (SELECT COUNT(*)::int AS "totalThreadCount" FROM unread) totals
    LEFT JOIN page ON true
    ORDER BY page."lastUnreadAt" DESC, page."parentMessageId" DESC
  `,
    ...uniqueRoomIds,
    userId,
    limit + 1,
    ...(cursor ? [cursor] : []),
  );

  const pageRows = rows.filter(
    (row): row is UnreadThreadRow & { totalThreadCount: number | bigint } =>
      row.parentMessageId !== null,
  );
  const hasMore = pageRows.length > limit;
  const threads = pageRows.slice(0, limit).map((row) => ({
    roomId: row.roomId,
    ...mapUnreadThreadRow(row),
  }));
  return {
    threads,
    nextCursor: hasMore ? (threads.at(-1)?.parentMessageId ?? null) : null,
    total: Number(rows[0]?.totalThreadCount ?? 0),
  };
}

/**
 * The unread Threads of the rooms that have any, going by their counts.
 *
 * The list is a second scan of the same replies the counts just read, so it
 * is kept to the rooms where that scan can find something. The sidebar polls
 * the room list, and most polls find no Thread unread at all.
 */
export async function listUnreadThreadsOfRoomsWithThreadUnread(
  unreadCounts: ReadonlyMap<string, ChatRoomUnreadBreakdown>,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, ChatRoomUnreadThreads>> {
  const roomIds = [...unreadCounts]
    .filter(([, breakdown]) => breakdown.thread > 0)
    .map(([roomId]) => roomId);
  return listChatRoomUnreadThreads(roomIds, userId, tx);
}

/**
 * Everything unread a single room's summary carries: the three counts, and
 * the room's unread Threads for the sidebar.
 *
 * The single-room routes feed the sidebar too. A room read, a Look, a star
 * or a mute answers with the room, and the row is redrawn from that answer,
 * so an answer without the Threads would empty the row's inset list. The
 * Threads are read only when the room has Thread unread, which most do not.
 */
export async function roomUnreadFields(
  breakdown: ChatRoomUnreadBreakdown | undefined,
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<
  ReturnType<typeof unreadCountFields> & {
    unreadThreads: ChatRoomUnreadThreads;
  }
> {
  const unreadThreads = await listUnreadThreadsOfRoomsWithThreadUnread(
    new Map(breakdown ? [[roomId, breakdown]] : []),
    userId,
    tx,
  );
  return {
    ...unreadCountFields(breakdown),
    unreadThreads: unreadThreads.get(roomId) ?? emptyChatRoomUnreadThreads(),
  };
}

export interface ChatEarlierThread {
  roomId: string;
  parentMessageId: string;
  /** The parent's raw content, cut short. The client builds the label. */
  parentContent: string;
  replyCount: number;
  lastReplyAt: Date;
  /** Where opening the Thread lands: its newest reply. */
  lastReplyId: string;
}

export interface ChatEarlierThreadsPage {
  /** Newest reply first. */
  threads: ChatEarlierThread[];
  nextCursor: string | null;
  total: number;
}

/**
 * The reader's Threads with nothing unread, across rooms: the Earlier group
 * under the Threads view's unread ones (SOK-1159), as a room's own Thread
 * list groups its Threads.
 *
 * The reader's Participant Threads (ADR-0013), less every Thread the unread
 * fragment finds, so a Thread is in exactly one of the two groups. Ranked by
 * newest reply and paged by parent id, the way the unread list pages; the
 * total rides a joined count, so an empty page past a stale cursor still
 * states it.
 */
export async function listEarlierThreadsAcrossRooms(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
  options: { cursor?: string; limit: number },
): Promise<ChatEarlierThreadsPage> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return { threads: [], nextCursor: null, total: 0 };
  }

  const { cursor, limit } = options;
  const roomIdPlaceholders = sqlRoomIdPlaceholders(uniqueRoomIds.length);
  const userIdPlaceholder = `$${uniqueRoomIds.length + 1}`;
  const limitPlaceholder = `$${uniqueRoomIds.length + 2}`;
  const cursorPlaceholder = `$${uniqueRoomIds.length + 3}::uuid`;

  type EarlierRow = {
    roomId: string;
    parentMessageId: string;
    parentContent: string;
    replyCount: number | bigint;
    lastReplyAt: Date;
    lastReplyId: string;
    totalThreadCount: number | bigint;
  };
  const rows = await tx.$queryRawUnsafe<
    Array<
      EarlierRow | { parentMessageId: null; totalThreadCount: number | bigint }
    >
  >(
    `
    WITH unread_parent AS (
      SELECT DISTINCT parent.id
      ${sqlUnreadThreadReplies(roomIdPlaceholders, userIdPlaceholder)}
    ),
    earlier AS (
      SELECT
        parent."roomId" AS "roomId",
        parent.id AS "parentMessageId",
        LEFT(parent.content, ${CHAT_ROOM_UNREAD_THREAD_CONTENT_CHARS})
          AS "parentContent",
        COUNT(reply.id)::int AS "replyCount",
        MAX(reply."createdAt") AS "lastReplyAt",
        (ARRAY_AGG(reply.id ORDER BY reply."createdAt" DESC, reply.id DESC))[1]
          AS "lastReplyId"
      FROM "chat_room_message" reply
      INNER JOIN "chat_room_message" parent
        ON parent.id = reply."parentMessageId"
        AND parent."roomId" = reply."roomId"
      WHERE reply."roomId" IN (${roomIdPlaceholders})
        AND reply."deletedAt" IS NULL
        AND parent."deletedAt" IS NULL
        AND parent."parentMessageId" IS NULL
        AND ${sqlViewerIsThreadParticipant(userIdPlaceholder)}
        AND parent.id NOT IN (SELECT id FROM unread_parent)
      -- parent.id is the primary key, so its other columns ride along.
      GROUP BY parent.id
    ),
    page AS (
      SELECT earlier.*
      FROM earlier
      ${
        cursor
          ? `WHERE ("lastReplyAt", "parentMessageId") < (
        SELECT cursor_thread."lastReplyAt", cursor_thread."parentMessageId"
        FROM earlier cursor_thread
        WHERE cursor_thread."parentMessageId" = ${cursorPlaceholder}
      )`
          : ""
      }
      ORDER BY "lastReplyAt" DESC, "parentMessageId" DESC
      LIMIT ${limitPlaceholder}
    )
    SELECT page.*, totals."totalThreadCount"
    FROM (SELECT COUNT(*)::int AS "totalThreadCount" FROM earlier) totals
    LEFT JOIN page ON true
    ORDER BY page."lastReplyAt" DESC, page."parentMessageId" DESC
  `,
    ...uniqueRoomIds,
    userId,
    limit + 1,
    ...(cursor ? [cursor] : []),
  );

  const pageRows = rows.filter(
    (row): row is EarlierRow => row.parentMessageId !== null,
  );
  const hasMore = pageRows.length > limit;
  const threads = pageRows.slice(0, limit).map((row) => ({
    roomId: row.roomId,
    parentMessageId: row.parentMessageId,
    parentContent: row.parentContent,
    replyCount: Number(row.replyCount),
    lastReplyAt: row.lastReplyAt,
    lastReplyId: row.lastReplyId,
  }));
  return {
    threads,
    nextCursor: hasMore ? (threads.at(-1)?.parentMessageId ?? null) : null,
    total: Number(rows[0]?.totalThreadCount ?? 0),
  };
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
