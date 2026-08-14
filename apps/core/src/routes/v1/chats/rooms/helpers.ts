import { MemberRole, NotificationKind, type Prisma } from "@sokosumi/database";
import { buildRoomQuoteSnippetParts } from "@sokosumi/utils";

import {
  buildCoworkerNonEmptyBaseUrlWhere,
  buildCoworkerUsableInWorkspaceWhere,
  hasNonEmptyBaseUrl,
} from "@/helpers/access-control";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import prisma from "@/lib/db/prisma";
import {
  type ChatRoomMessageQuote,
  type ChatRoomMessageUnfurl,
  MAX_LISTED_CHAT_REACTION_REACTORS,
} from "@/schemas/chat-room.schema";

import {
  assertChatRoomContentMessage,
  readMembershipFromMetadata,
} from "./membership-status";

export const chatRoomUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const satisfies Prisma.UserSelect;

export const chatRoomCoworkerSelect = {
  id: true,
  name: true,
  slug: true,
  caption: true,
  image: true,
} as const satisfies Prisma.CoworkerSelect;

type ChatRoomPresence = "online" | "afk" | "offline";

export const chatRoomInclude = {
  userMembers: {
    include: {
      user: { select: chatRoomUserSelect },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  coworkerMembers: {
    include: {
      coworker: { select: chatRoomCoworkerSelect },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ChatRoomInclude;

export const chatRoomMessageInclude = {
  senderUser: { select: chatRoomUserSelect },
  senderCoworker: { select: chatRoomCoworkerSelect },
  mentionsAsSource: {
    select: {
      id: true,
      coworkerId: true,
      status: true,
      responseMessageId: true,
    },
    orderBy: { createdAt: "asc" },
  },
  reactions: {
    select: {
      emoji: true,
      userId: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  // Soft-deleted replies stay in the DB (tombstones) but must not inflate
  // threadReplyCount / threadLastReplyAt — same rule as getChatRoomThreadAggregates.
  replies: {
    where: { deletedAt: null },
    select: {
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  _count: {
    select: {
      replies: { where: { deletedAt: null } },
    },
  },
} as const satisfies Prisma.ChatRoomMessageInclude;

type ChatRoomWithMembers = Prisma.ChatRoomGetPayload<{
  include: typeof chatRoomInclude;
}>;

type ChatRoomMessageWithSender = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

/**
 * REST placeholder for human presence (ADR-0003).
 * Live Online/AFK comes from Ably Presence on the client. Self stays online on
 * personalized REST so the viewer never flashes offline before Ably hydrates.
 */
function resolveUserPresence(
  user: Pick<ChatRoomWithMembers["userMembers"][number]["user"], "id">,
  currentUserId?: string,
): ChatRoomPresence {
  if (user.id === currentUserId) {
    return "online";
  }
  return "offline";
}

/**
 * Per-room unread message counts for sidebar attention.
 *
 * Dual baseline (matches the two read-state tables):
 * - Top-level messages (`parentMessageId IS NULL`): after room `lastReadAt`
 * - Thread replies: after per-thread look baseline
 *   (`ChatRoomThreadReadState.lastReadAt`, else room read-state `createdAt`,
 *   else -infinity) — same as `getChatRoomThreadAggregates`. Room mark-read
 *   must not clear thread look contribution; looking a thread must.
 *
 * Soft-deleted messages and the viewer's own user messages are excluded.
 */
export async function getChatRoomUnreadCounts(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, number>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const roomIdPlaceholders = uniqueRoomIds
    .map((_, index) => `$${index + 1}::uuid`)
    .join(", ");
  const userIdPlaceholder = `$${uniqueRoomIds.length + 1}`;

  const rows = await tx.$queryRawUnsafe<
    Array<{ roomId: string; unreadCount: number | bigint }>
  >(
    `
    SELECT
      combined."roomId" AS "roomId",
      COUNT(*)::int AS "unreadCount"
    FROM (
      SELECT message.id, message."roomId"
      FROM "chat_room_message" message
      LEFT JOIN "chat_room_read_state" read_state
        ON read_state."roomId" = message."roomId"
        AND read_state."userId" = ${userIdPlaceholder}
      WHERE message."roomId" IN (${roomIdPlaceholders})
        AND message."parentMessageId" IS NULL
        AND message."deletedAt" IS NULL
        AND message."createdAt" > COALESCE(read_state."lastReadAt", '-infinity'::timestamp)
        AND (message."senderUserId" IS NULL OR message."senderUserId" <> ${userIdPlaceholder})

      UNION ALL

      SELECT reply.id, reply."roomId"
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
        AND reply."createdAt" > COALESCE(
          thread_read."lastReadAt",
          room_read."createdAt",
          '-infinity'::timestamp
        )
        AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> ${userIdPlaceholder})
    ) combined
    GROUP BY combined."roomId"
  `,
    ...uniqueRoomIds,
    userId,
  );

  return new Map(rows.map((row) => [row.roomId, Number(row.unreadCount)]));
}

export interface ChatRoomThreadAggregate {
  parentMessageId: string;
  replyCount: number;
  lastReplyAt: Date;
  unreadReplyCount: number;
  lastUnreadReplyAt: Date | null;
}

/**
 * Parents (top-level messages) in a room that have ≥1 non-deleted reply,
 * with per-user unread counts.
 *
 * A thread is unread only after a prior look row
 * (`ChatRoomThreadReadState.lastReadAt`). Never-looked threads have
 * unreadReplyCount 0 (ADR-0005). Never uses room lastReadAt or room
 * read-state createdAt for thread unread.
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
        WHERE thread_read."lastReadAt" IS NOT NULL
          AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> $2)
          AND reply."createdAt" > thread_read."lastReadAt"
      )::int AS "unreadReplyCount",
      MAX(reply."createdAt") FILTER (
        WHERE thread_read."lastReadAt" IS NOT NULL
          AND (reply."senderUserId" IS NULL OR reply."senderUserId" <> $2)
          AND reply."createdAt" > thread_read."lastReadAt"
      ) AS "lastUnreadReplyAt"
    FROM "chat_room_message" reply
    INNER JOIN "chat_room_message" parent
      ON parent.id = reply."parentMessageId"
      AND parent."roomId" = reply."roomId"
    LEFT JOIN "chat_room_thread_read_state" thread_read
      ON thread_read."parentMessageId" = parent.id
      AND thread_read."userId" = $2
    WHERE reply."roomId" = $1::uuid
      AND reply."parentMessageId" IS NOT NULL
      AND reply."deletedAt" IS NULL
      AND parent."deletedAt" IS NULL
      AND parent."parentMessageId" IS NULL
      ${parentMessageId ? "AND parent.id = $3::uuid" : ""}
    GROUP BY parent.id
    HAVING COUNT(reply.id) >= 1
  `;

  const recencySql = recency
    ? `
    SELECT * FROM (${innerSelect}) threads
    WHERE "unreadReplyCount" = 0
      AND (
        $3::uuid IS NULL
        OR ("lastReplyAt", "parentMessageId") < (
          SELECT MAX(r."createdAt"), $3::uuid
          FROM "chat_room_message" r
          WHERE r."parentMessageId" = $3::uuid
            AND r."deletedAt" IS NULL
            AND r."roomId" = $1::uuid
        )
      )
    ORDER BY "lastReplyAt" DESC, "parentMessageId" DESC
    LIMIT $4
    `
    : unreadOnly
      ? `
    SELECT * FROM (${innerSelect}) threads
    WHERE "unreadReplyCount" >= 1
    ORDER BY "lastUnreadReplyAt" DESC, "parentMessageId" DESC
    `
      : `
    ${innerSelect}
    ORDER BY MAX(reply."createdAt") DESC
    `;

  const queryArgs = recency
    ? [roomId, userId, recency.cursor ?? null, recency.limit + 1]
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
    }>
  >(recencySql, ...queryArgs);

  return rows.map((row) => ({
    parentMessageId: row.parentMessageId,
    replyCount: Number(row.replyCount),
    lastReplyAt: row.lastReplyAt,
    unreadReplyCount: Number(row.unreadReplyCount),
    lastUnreadReplyAt: row.lastUnreadReplyAt,
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
      },
    ];
  });
}

/**
 * List threads in a room. When `unreadOnly`, only parents with ≥1 unread
 * non-self reply after a prior look (ADR-0005).
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
 * Full room thread list: all unread threads, then a recency page of the rest
 * (looked + never-looked) by last reply. Cursor pages are recency-only.
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

  const readAt = new Date();
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
 * Upsert look state for every parent currently needing attention in the room.
 * Does not change room ChatRoomReadState or CHAT notifications.
 */
export async function markAllChatRoomThreadsRead(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const aggregates = await getChatRoomThreadAggregates(roomId, userId, tx, {
    unreadOnly: true,
  });
  if (aggregates.length === 0) {
    return 0;
  }

  const readAt = new Date();
  for (const aggregate of aggregates) {
    await tx.chatRoomThreadReadState.upsert({
      where: {
        userId_parentMessageId: {
          userId,
          parentMessageId: aggregate.parentMessageId,
        },
      },
      update: { lastReadAt: readAt },
      create: {
        userId,
        parentMessageId: aggregate.parentMessageId,
        lastReadAt: readAt,
      },
    });
  }

  return aggregates.length;
}

/**
 * Per-room count of unread CHAT notifications for the user.
 * `referenceId` is the room id (see emitChatMentionNotifications).
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
      isRead: false,
      referenceId: { in: uniqueRoomIds },
    },
    _count: { _all: true },
  });

  return new Map(
    groups.map((group) => [group.referenceId, group._count._all] as const),
  );
}

/** Latest message time per room — used to order the sidebar by real activity. */
export async function getChatRoomLastMessageAts(
  roomIds: readonly string[],
  tx: Prisma.TransactionClient,
): Promise<Map<string, Date>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const groups = await tx.chatRoomMessage.groupBy({
    by: ["roomId"],
    where: { roomId: { in: uniqueRoomIds } },
    _max: { createdAt: true },
  });

  return new Map(
    groups.flatMap((group) =>
      group._max.createdAt
        ? ([[group.roomId, group._max.createdAt]] as const)
        : [],
    ),
  );
}

export interface MapChatRoomAttentionOptions {
  unreadCount?: number;
  unreadMentionCount?: number;
  /** Prefer latest message time when room.updatedAt lagged (legacy stream writes). */
  lastActivityAt?: Date | null;
  pinnedAt?: Date | null;
  mutedAt?: Date | null;
  markedUnread?: boolean;
  /** Override caller's room access; otherwise derived from membership row. */
  myAccess?: "member" | "guest";
  /** Host org display name when batch-loaded (Task 5+); null for directs. */
  organizationName?: string | null;
}

function resolveMyAccess(
  room: ChatRoomWithMembers,
  currentUserId: string | undefined,
  override: "member" | "guest" | undefined,
): "member" | "guest" {
  if (override) {
    return override;
  }
  if (!currentUserId) {
    return "member";
  }
  const membership = room.userMembers.find(
    (member) => member.userId === currentUserId,
  );
  return membership?.access === "guest" ? "guest" : "member";
}

export function mapChatRoom(
  room: ChatRoomWithMembers,
  currentUserId?: string,
  attention: MapChatRoomAttentionOptions = {},
) {
  const {
    unreadCount = 0,
    unreadMentionCount = 0,
    lastActivityAt,
    pinnedAt = null,
    mutedAt = null,
    markedUnread = false,
    myAccess: myAccessOverride,
    organizationName = null,
  } = attention;

  return {
    id: room.id,
    organizationId: room.organizationId,
    organizationName,
    name: room.name,
    slug: room.slug,
    kind: room.kind as "channel" | "direct",
    directKey: room.directKey,
    topic: room.topic,
    discoverability: mapChatRoomDiscoverability(
      room.kind,
      room.discoverability,
    ),
    createdByUserId: room.createdByUserId,
    createdAt: room.createdAt,
    updatedAt: lastActivityAt ?? room.updatedAt,
    unreadCount,
    unreadMentionCount,
    pinnedAt,
    mutedAt,
    markedUnread,
    myAccess: resolveMyAccess(room, currentUserId, myAccessOverride),
    userMembers: room.userMembers.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image ?? null,
      presence: resolveUserPresence(member.user, currentUserId),
      access:
        member.access === "guest" ? ("guest" as const) : ("member" as const),
    })),
    coworkerMembers: room.coworkerMembers.map(({ coworker }) => ({
      id: coworker.id,
      name: coworker.name,
      slug: coworker.slug,
      caption: coworker.caption ?? null,
      image: coworker.image ?? null,
      presence: "online" as const,
    })),
  };
}

function mapChatRoomDiscoverability(
  kind: string,
  discoverability: string | null,
): "public" | "private" | "external" | null {
  if (kind === "direct") {
    return null;
  }
  if (discoverability === "public") {
    return "public";
  }
  if (discoverability === "external") {
    return "external";
  }
  return "private";
}

export interface ChatRoomSidebarFlags {
  pinnedAt: Date | null;
  mutedAt: Date | null;
  markedUnread: boolean;
}

/** Batch-load per-user pin + mute + forced-unread flags for sidebar mapping. */
export async function getChatRoomSidebarFlags(
  roomIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, ChatRoomSidebarFlags>> {
  const uniqueRoomIds = normalizeUniqueStrings(roomIds);
  if (uniqueRoomIds.length === 0) {
    return new Map();
  }

  const [memberships, readStates] = await Promise.all([
    tx.chatRoomUserMember.findMany({
      where: {
        userId,
        roomId: { in: uniqueRoomIds },
      },
      select: {
        roomId: true,
        pinnedAt: true,
        mutedAt: true,
      },
    }),
    tx.chatRoomReadState.findMany({
      where: {
        userId,
        roomId: { in: uniqueRoomIds },
      },
      select: {
        roomId: true,
        markedUnreadAt: true,
      },
    }),
  ]);

  const flagged = new Map<string, ChatRoomSidebarFlags>(
    uniqueRoomIds.map((roomId) => [
      roomId,
      { pinnedAt: null, mutedAt: null, markedUnread: false },
    ]),
  );

  for (const membership of memberships) {
    const current = flagged.get(membership.roomId);
    if (current) {
      current.pinnedAt = membership.pinnedAt;
      current.mutedAt = membership.mutedAt;
    }
  }

  for (const readState of readStates) {
    const current = flagged.get(readState.roomId);
    if (current) {
      current.markedUnread = readState.markedUnreadAt != null;
    }
  }

  return flagged;
}

/** mapChatRoom with per-user pin/mute/markedUnread loaded for the viewer. */
export async function mapChatRoomWithSidebarFlags(
  room: ChatRoomWithMembers,
  userId: string,
  tx: Prisma.TransactionClient,
  attention: {
    unreadCount?: number;
    unreadMentionCount?: number;
    lastActivityAt?: Date | null;
  } = {},
) {
  const flags = (await getChatRoomSidebarFlags([room.id], userId, tx)).get(
    room.id,
  );

  return mapChatRoom(room, userId, {
    unreadCount: attention.unreadCount ?? 0,
    unreadMentionCount: attention.unreadMentionCount ?? 0,
    lastActivityAt: attention.lastActivityAt,
    pinnedAt: flags?.pinnedAt ?? null,
    mutedAt: flags?.mutedAt ?? null,
    markedUnread: flags?.markedUnread ?? false,
  });
}

export function mapChatRoomMessage(
  message: ChatRoomMessageWithSender,
  currentUserId?: string,
) {
  const sender = (() => {
    if (message.senderUser) {
      return {
        type: "user" as const,
        user: {
          id: message.senderUser.id,
          name: message.senderUser.name,
          email: message.senderUser.email,
          image: message.senderUser.image ?? null,
          presence: resolveUserPresence(message.senderUser, currentUserId),
        },
      };
    }

    if (message.senderCoworker) {
      return {
        type: "coworker" as const,
        coworker: {
          id: message.senderCoworker.id,
          name: message.senderCoworker.name,
          slug: message.senderCoworker.slug,
          caption: message.senderCoworker.caption ?? null,
          image: message.senderCoworker.image ?? null,
          presence: "online" as const,
        },
      };
    }

    return { type: "unknown" as const };
  })();

  const reactionCounts = new Map<
    string,
    {
      count: number;
      reactedByCurrentUser: boolean;
      reactors: Array<{ id: string; name: string }>;
    }
  >();
  for (const reaction of message.reactions) {
    const current = reactionCounts.get(reaction.emoji) ?? {
      count: 0,
      reactedByCurrentUser: false,
      reactors: [],
    };
    current.count += 1;
    current.reactedByCurrentUser =
      current.reactedByCurrentUser || reaction.userId === currentUserId;
    if (current.reactors.length < MAX_LISTED_CHAT_REACTION_REACTORS) {
      current.reactors.push({
        id: reaction.user.id,
        name: reaction.user.name,
      });
    }
    reactionCounts.set(reaction.emoji, current);
  }

  const metadata = (message.metadata as Record<string, unknown> | null) ?? null;
  const isDeleted = message.deletedAt != null;

  return {
    id: message.id,
    roomId: message.roomId,
    parentMessageId: message.parentMessageId,
    content: isDeleted ? "" : message.content,
    createdAt: message.createdAt,
    deletedAt: message.deletedAt ?? null,
    editedAt: isDeleted ? null : (message.editedAt ?? null),
    sender,
    mentions: isDeleted
      ? []
      : message.mentionsAsSource.map((mention) => ({
          id: mention.id,
          coworkerId: mention.coworkerId,
          status: mention.status,
          responseMessageId: mention.responseMessageId,
        })),
    reactions: isDeleted
      ? []
      : Array.from(reactionCounts.entries()).map(([emoji, reaction]) => ({
          emoji,
          count: reaction.count,
          reactedByCurrentUser: reaction.reactedByCurrentUser,
          reactors: reaction.reactors,
        })),
    threadReplyCount: message._count.replies,
    threadLastReplyAt: message.replies[0]?.createdAt ?? null,
    metadata: isDeleted ? null : metadata,
    quote: isDeleted ? null : readQuoteFromMetadata(metadata),
    membership: isDeleted ? null : readMembershipFromMetadata(metadata),
    unfurls: isDeleted ? null : readUnfurlsFromMetadata(metadata),
  };
}

export function mergeChatRoomMessageMetadata(
  existing: unknown,
  quote: ChatRoomMessageQuote | null,
): Record<string, unknown> | null {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (quote) {
    base.quote = quote;
  }

  return Object.keys(base).length > 0 ? base : null;
}

/**
 * Replace `metadata.unfurls` from the latest scrape while preserving
 * quote / membership / other keys. Empty scrape removes the unfurls key.
 */
export function mergeUnfurlsIntoMessageMetadata(
  existing: unknown,
  unfurls: readonly ChatRoomMessageUnfurl[],
): Record<string, unknown> | null {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (unfurls.length === 0) {
    delete base.unfurls;
  } else {
    base.unfurls = [...unfurls];
  }

  return Object.keys(base).length > 0 ? base : null;
}

export function readUnfurlsFromMetadata(
  metadata: Record<string, unknown> | null,
): ChatRoomMessageUnfurl[] | null {
  const raw = metadata?.unfurls;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const parsed: ChatRoomMessageUnfurl[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.url !== "string" ||
      typeof candidate.title !== "string" ||
      candidate.title.trim().length === 0
    ) {
      continue;
    }
    if (
      candidate.description !== null &&
      typeof candidate.description !== "string"
    ) {
      continue;
    }
    if (candidate.imageUrl !== null && typeof candidate.imageUrl !== "string") {
      continue;
    }
    if (candidate.siteName !== null && typeof candidate.siteName !== "string") {
      continue;
    }
    parsed.push({
      url: candidate.url,
      title: candidate.title,
      description: (candidate.description as string | null) ?? null,
      imageUrl: (candidate.imageUrl as string | null) ?? null,
      siteName: (candidate.siteName as string | null) ?? null,
    });
    if (parsed.length >= 3) {
      break;
    }
  }

  return parsed.length > 0 ? parsed : null;
}

function readQuoteAttachmentFromMetadata(
  candidate: Record<string, unknown>,
): ChatRoomMessageQuote["attachment"] {
  if (!("attachment" in candidate)) {
    return undefined;
  }
  const raw = candidate.attachment;
  if (raw === null) {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const attachment = raw as Record<string, unknown>;
  if (
    typeof attachment.fileName !== "string" ||
    typeof attachment.url !== "string" ||
    (attachment.mediaKind !== "image" && attachment.mediaKind !== "file")
  ) {
    return undefined;
  }
  return {
    fileName: attachment.fileName,
    url: attachment.url,
    mediaKind: attachment.mediaKind,
  };
}

function readQuoteFromMetadata(
  metadata: Record<string, unknown> | null,
): ChatRoomMessageQuote | null {
  const raw = metadata?.quote;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.messageId !== "string" ||
    typeof candidate.authorName !== "string" ||
    typeof candidate.snippet !== "string"
  ) {
    return null;
  }
  const attachment = readQuoteAttachmentFromMetadata(candidate);
  return {
    messageId: candidate.messageId,
    authorName: candidate.authorName,
    snippet: candidate.snippet,
    ...(attachment !== undefined ? { attachment } : {}),
  };
}

/**
 * Resolve a same-room quote target into a durable snapshot. Missing or
 * cross-room ids are a client error (400), not a soft omit — the composer
 * already chose a specific message.
 */
export async function resolveRoomQuoteSnapshot(
  tx: Prisma.TransactionClient,
  roomId: string,
  quoteMessageId: string | undefined,
): Promise<ChatRoomMessageQuote | null> {
  if (!quoteMessageId) {
    return null;
  }

  const quoted = await tx.chatRoomMessage.findFirst({
    where: {
      id: quoteMessageId,
      roomId,
      deletedAt: null,
    },
    select: {
      id: true,
      content: true,
      metadata: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
    },
  });

  if (!quoted) {
    throw badRequest("Quoted message not found");
  }

  assertChatRoomContentMessage(quoted.metadata);

  const { snippet, attachment } = buildRoomQuoteSnippetParts(quoted.content);

  return {
    messageId: quoted.id,
    authorName:
      quoted.senderUser?.name ?? quoted.senderCoworker?.name ?? "Someone",
    snippet,
    attachment,
  };
}

export function normalizeUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Named channels are always organization scoped. Direct rooms usually inherit
 * the active organization; coworker 1:1 may be personal (`organizationId` null)
 * when created with no active org — callers must not assume an org.
 */
export function requireActiveOrganizationId(userContext: {
  organizationId: string | null;
}): string {
  if (!userContext.organizationId) {
    throw badRequest(
      "No active organization. Select an organization or send the X-Organization-Slug header.",
    );
  }

  return userContext.organizationId;
}

/** When the room belongs to an org, the caller must still be a member of that org. */
async function assertRoomOrganizationAccess(
  organizationId: string | null,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (!organizationId) {
    return;
  }
  await resolveMemberOrganizationById({
    id: organizationId,
    userId,
    tx,
  });
}

/**
 * Guests hold room membership without host-org `Member`. Skip the org gate for
 * `access=guest`; every other access (including default/legacy `member`) keeps it.
 */
async function assertRoomOrganizationAccessUnlessGuest(
  organizationId: string | null,
  userId: string,
  membershipAccess: string | null | undefined,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (membershipAccess === "guest") {
    return;
  }
  await assertRoomOrganizationAccess(organizationId, userId, tx);
}

export function membershipAccessForUser(
  userMembers: ReadonlyArray<{ userId: string; access?: string | null }>,
  userId: string,
): string | null | undefined {
  return userMembers.find((member) => member.userId === userId)?.access;
}

export function slugifyRoomName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "room";
}

export function buildDirectRoomKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(":");
}

export function buildDirectCoworkerRoomKey(
  userId: string,
  coworkerId: string,
): string {
  return `coworker:${userId}:${coworkerId}`;
}

export function buildDirectParticipantRoomKey(params: {
  currentUserId: string;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
}): string {
  const memberUserIds = normalizeUniqueStrings(params.memberUserIds);
  const coworkerIds = normalizeUniqueStrings(params.coworkerIds);

  if (memberUserIds.length === 1 && coworkerIds.length === 0) {
    return buildDirectRoomKey(params.currentUserId, memberUserIds[0]);
  }

  if (memberUserIds.length === 0 && coworkerIds.length === 1) {
    return buildDirectCoworkerRoomKey(params.currentUserId, coworkerIds[0]);
  }

  const participantKeys = [
    ...normalizeUniqueStrings([params.currentUserId, ...memberUserIds]).map(
      (userId) => `user:${userId}`,
    ),
    ...coworkerIds.map((coworkerId) => `coworker:${coworkerId}`),
  ].sort();

  return `direct:v2:${participantKeys.join(":")}`;
}

export function buildDirectRoomName(names: readonly string[]): string {
  const cleanNames = normalizeUniqueStrings(names);

  if (cleanNames.length === 0) {
    return "Direct message";
  }

  if (cleanNames.length <= 3) {
    return cleanNames.join(", ");
  }

  return `${cleanNames.slice(0, 3).join(", ")} and ${cleanNames.length - 3} more`;
}

export async function buildUniqueRoomSlug(
  organizationId: string | null,
  name: string,
  createdByUserId: string,
  tx: Prisma.TransactionClient,
): Promise<string> {
  const baseSlug = slugifyRoomName(name);
  const existing = await tx.chatRoom.findMany({
    where:
      organizationId === null
        ? {
            organizationId: null,
            createdByUserId,
            slug: { startsWith: baseSlug },
          }
        : {
            organizationId,
            slug: { startsWith: baseSlug },
          },
    select: { slug: true },
  });
  const used = new Set(existing.map((room) => room.slug));
  if (!used.has(baseSlug)) {
    return baseSlug;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw badRequest("Could not create a unique room slug");
}

/**
 * Organization owner/admin elevation for channel lifecycle and settings.
 * Room creator is provenance only — never authorizes.
 */
export function isOrganizationOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

/**
 * Archive and restore hide or resurface a room for everyone, so only an
 * organization owner/admin may do either. Plain members leave instead (or ask
 * someone elevated to archive).
 */
export function canManageChatRoomLifecycle(options: {
  /** Organization membership role from Prisma (`string`); compare to `MemberRole`. */
  role: string;
}): boolean {
  return isOrganizationOwnerOrAdmin(options.role);
}

/**
 * Permanent delete removes the room and cascaded children for everyone.
 * Same elevation as archive/restore — organization owner/admin only.
 */
export function canPermanentlyDeleteChatRoom(options: {
  role: string;
}): boolean {
  return canManageChatRoomLifecycle(options);
}

export function chatRoomPatchTouchesSettings(body: {
  name?: unknown;
  topic?: unknown;
  discoverability?: unknown;
}): boolean {
  return (
    body.name !== undefined ||
    body.topic !== undefined ||
    body.discoverability !== undefined
  );
}

/**
 * Split PATCH gates (after caller proven access=member, not guest):
 * settings (name/topic/discoverability) need OWNER/ADMIN; roster rewrite is
 * allowed for any host-org room member. Fail settings before any writes.
 */
export function assertChatRoomPatchAuth(options: {
  role: string;
  body: {
    name?: unknown;
    topic?: unknown;
    discoverability?: unknown;
    memberUserIds?: unknown;
    coworkerIds?: unknown;
  };
}): void {
  if (
    chatRoomPatchTouchesSettings(options.body) &&
    !isOrganizationOwnerOrAdmin(options.role)
  ) {
    throw forbidden(
      "Only an organization owner or admin can update channel settings.",
    );
  }
}

export async function requireChatRoomUserAccess(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<ChatRoomWithMembers> {
  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      archivedAt: null,
      userMembers: {
        some: { userId },
      },
    },
    include: chatRoomInclude,
  });

  if (!room) {
    throw notFound("Room not found");
  }

  await assertRoomOrganizationAccessUnlessGuest(
    room.organizationId,
    userId,
    membershipAccessForUser(room.userMembers, userId),
    tx,
  );

  return room;
}

/**
 * Whether a channel's discoverability allows self-join for this caller.
 * Public/external: any org member. Private: organization owner/admin only.
 */
export function isJoinableChannelDiscoverability(
  discoverability: string | null,
  elevated: boolean,
): boolean {
  if (discoverability === "public" || discoverability === "external") {
    return true;
  }
  return elevated && discoverability === "private";
}

/**
 * Prisma discoverability filter for browse/self-join listing.
 * Plain members: public + external. Owner/admin: public + private + external.
 * Mutable `in` array (not `as const`) — Prisma rejects readonly tuples.
 */
export function buildDiscoverabilityFilter(elevated: boolean): {
  in: string[];
} {
  return elevated
    ? { in: ["public", "private", "external"] }
    : { in: ["public", "external"] };
}

/**
 * Active org channel the caller may self-join. Does not require membership.
 * Public/external: any org member. Private: organization owner/admin only.
 * Host-org membership is still required (guests never self-join).
 * Unknown, wrong-org, direct, archived, or private-for-plain-member → 404.
 */
export async function requireJoinableOrgChannel(
  roomId: string,
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<{ room: ChatRoomWithMembers; elevated: boolean }> {
  const { role } = await resolveMemberOrganizationById({
    id: organizationId,
    userId,
    tx,
  });
  const elevated = isOrganizationOwnerOrAdmin(role);

  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      organizationId,
      kind: "channel",
      archivedAt: null,
      discoverability: buildDiscoverabilityFilter(elevated),
    },
    include: chatRoomInclude,
  });

  if (!room) {
    throw notFound("Room not found");
  }

  return { room, elevated };
}

/**
 * Membership-scoped lookup for soft-archived rooms. Active-room helpers filter
 * `archivedAt: null`, so restore / archived list cannot reuse them.
 */
export async function requireArchivedChatRoomUserAccess(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<ChatRoomWithMembers> {
  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      archivedAt: { not: null },
      userMembers: {
        some: { userId },
      },
    },
    include: chatRoomInclude,
  });

  if (!room) {
    throw notFound("Room not found");
  }

  await assertRoomOrganizationAccessUnlessGuest(
    room.organizationId,
    userId,
    membershipAccessForUser(room.userMembers, userId),
    tx,
  );

  return room;
}

// Write paths need room identity, coworker roster for AI mention dispatch,
// and human member names for resolveMentionedUserIds. Avoid the full include
// (sessions / presence) — that would pull hundreds of unused rows per message.
const chatRoomWriteSelect = {
  id: true,
  name: true,
  organizationId: true,
  slug: true,
  kind: true,
  providerConversationId: true,
  userMembers: {
    select: {
      userId: true,
      access: true,
      user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  coworkerMembers: {
    select: {
      coworker: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ChatRoomSelect;

type ChatRoomForWrite = Prisma.ChatRoomGetPayload<{
  select: typeof chatRoomWriteSelect;
}>;

export async function requireChatRoomUserWriteAccess(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<ChatRoomForWrite> {
  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      archivedAt: null,
      userMembers: {
        some: { userId },
      },
    },
    select: chatRoomWriteSelect,
  });

  if (!room) {
    throw notFound("Room not found");
  }

  await assertRoomOrganizationAccessUnlessGuest(
    room.organizationId,
    userId,
    membershipAccessForUser(room.userMembers, userId),
    tx,
  );

  return room;
}

/**
 * Resolve a thread parent for write paths. Nested reply ids collapse to the
 * top-level root so all siblings share one parentMessageId.
 */
export async function resolveThreadParentMessageId(
  tx: Prisma.TransactionClient,
  roomId: string,
  requestedParentMessageId: string | undefined,
): Promise<string | null> {
  if (!requestedParentMessageId) {
    return null;
  }
  const parentMessage = await tx.chatRoomMessage.findFirst({
    where: {
      id: requestedParentMessageId,
      roomId,
    },
    select: {
      id: true,
      parentMessageId: true,
    },
  });
  if (!parentMessage) {
    throw badRequest("Thread message not found");
  }
  return parentMessage.parentMessageId ?? parentMessage.id;
}

export async function requireChatRoomUserMembership(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<{ id: string; organizationId: string | null }> {
  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      archivedAt: null,
      userMembers: {
        some: { userId },
      },
    },
    select: {
      id: true,
      organizationId: true,
      userMembers: {
        where: { userId },
        select: { access: true },
        take: 1,
      },
    },
  });

  if (!room) {
    throw notFound("Room not found");
  }

  await assertRoomOrganizationAccessUnlessGuest(
    room.organizationId,
    userId,
    room.userMembers?.[0]?.access,
    tx,
  );

  return {
    id: room.id,
    organizationId: room.organizationId,
  };
}

/**
 * Host-org room member (`access=member`) on an external channel may invite
 * guests. Guests and non-external rooms are rejected.
 */
export async function requireRoomMemberCanInviteGuests(
  roomId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<ChatRoomWithMembers> {
  const room = await requireChatRoomUserAccess(roomId, userId, tx);

  if (room.kind !== "channel" || room.discoverability !== "external") {
    throw notFound("Room not found");
  }

  const access = membershipAccessForUser(room.userMembers, userId);
  if (access === "guest") {
    throw forbidden("Only host organization members can invite guests.");
  }

  return room;
}

/**
 * Coworker membership for active (non-archived) rooms. Mirrors the inline gate
 * on coworker message POST. Returns 404 when missing or archived.
 */
export async function requireChatRoomCoworkerAccess(
  roomId: string,
  coworkerId: string,
  tx: Prisma.TransactionClient,
): Promise<{ id: string }> {
  const room = await tx.chatRoom.findFirst({
    where: {
      id: roomId,
      archivedAt: null,
      coworkerMembers: {
        some: { coworkerId },
      },
    },
    select: { id: true },
  });

  if (!room) {
    throw notFound("Room not found");
  }

  return room;
}

export async function validateOrganizationUserIds(
  organizationId: string,
  userIds: readonly string[],
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const uniqueUserIds = normalizeUniqueStrings(userIds);
  if (uniqueUserIds.length === 0) {
    return [];
  }

  const members = await tx.member.findMany({
    where: {
      organizationId,
      userId: { in: uniqueUserIds },
    },
    select: { userId: true },
  });
  const found = new Set(members.map((member) => member.userId));
  const missing = uniqueUserIds.filter((userId) => !found.has(userId));

  if (missing.length > 0) {
    throw badRequest("Room human members must belong to the organization");
  }

  return uniqueUserIds;
}

/**
 * Org room → org Workspace. Personal room → personal workspace of the acting
 * human (membership) / message sender (dispatch). Fail closed if missing.
 */
export async function resolveWorkspaceIdForChatRoom(params: {
  organizationId: string | null;
  /** personal rooms: human actor / message sender */
  personalUserId: string;
  tx?: Prisma.TransactionClient;
}): Promise<string> {
  const client = params.tx ?? prisma;
  if (params.organizationId) {
    const workspace = await client.workspace.findUnique({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });
    if (!workspace) {
      throw badRequest("Organization workspace not found");
    }
    return workspace.id;
  }

  const workspace = await client.workspace.findUnique({
    where: { userId: params.personalUserId },
    select: { id: true },
  });
  if (!workspace) {
    throw badRequest("Personal workspace not found");
  }
  return workspace.id;
}

export async function validateChatCoworkerIds(
  coworkerIds: readonly string[],
  workspaceId: string,
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const uniqueCoworkerIds = normalizeUniqueStrings(coworkerIds);
  if (uniqueCoworkerIds.length === 0) {
    return [];
  }

  const coworkers = await tx.coworker.findMany({
    where: {
      id: { in: uniqueCoworkerIds },
      ...buildCoworkerUsableInWorkspaceWhere(workspaceId),
      ...buildCoworkerNonEmptyBaseUrlWhere(),
      capabilities: { has: "chat" },
    },
    select: { id: true, baseURL: true },
  });
  const found = new Set(
    coworkers
      .filter((coworker) => hasNonEmptyBaseUrl(coworker.baseURL))
      .map((coworker) => coworker.id),
  );
  const missing = uniqueCoworkerIds.filter(
    (coworkerId) => !found.has(coworkerId),
  );

  if (missing.length > 0) {
    throw badRequest("Room AI coworkers must be active chat coworkers");
  }

  return uniqueCoworkerIds;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveMentionedCoworkerIds(params: {
  content: string;
  explicitCoworkerIds?: readonly string[];
  roomCoworkers: Array<{ id: string; name: string; slug: string }>;
}): string[] {
  const roomCoworkerIds = new Set(
    params.roomCoworkers.map((coworker) => coworker.id),
  );
  const mentionedIds = new Set(
    normalizeUniqueStrings(params.explicitCoworkerIds ?? []).filter((id) =>
      roomCoworkerIds.has(id),
    ),
  );

  const slugToId = new Map(
    params.roomCoworkers.map((coworker) => [coworker.slug, coworker.id]),
  );

  const tokenRegex = /@coworker:([a-z0-9][a-z0-9-]*)/gi;
  for (const match of params.content.matchAll(tokenRegex)) {
    const slug = match[1]?.toLowerCase();
    const id = slug ? slugToId.get(slug) : null;
    if (id) {
      mentionedIds.add(id);
    }
  }

  for (const coworker of params.roomCoworkers) {
    const aliases = new Set([
      coworker.slug.toLowerCase(),
      slugifyRoomName(coworker.name),
    ]);
    for (const alias of aliases) {
      const aliasRegex = new RegExp(
        `(^|\\s)@${escapeRegExp(alias)}(?=$|[\\s.,!?;:])`,
        "i",
      );
      if (aliasRegex.test(params.content)) {
        mentionedIds.add(coworker.id);
      }
    }
  }

  const allowedIds = new Set(params.roomCoworkers.map(({ id }) => id));
  return [...mentionedIds].filter((coworkerId) => allowedIds.has(coworkerId));
}

/** Catalog / content sentinel for room-wide @all. Not a user UUID. */
export const ROOM_MENTION_ALL_ID = "all" as const;

/**
 * Unwrap common inline markdown around @all tokens so composer bold/italic/code
 * (`**@all:all**`, `_@all_`, `` `@all:all` ``) still notify. Case-sensitive.
 */
function unwrapRoomAllMentionMarkdown(content: string): string {
  return content
    .replace(/\*\*(@all:all|@all)\*\*/g, " $1 ")
    .replace(/__(@all:all|@all)__/g, " $1 ")
    .replace(/~~(@all:all|@all)~~/g, " $1 ")
    .replace(/`(@all:all|@all)`/g, " $1 ")
    .replace(/_(@all:all|@all)_/g, " $1 ");
}

/**
 * True when content includes a room-all mention: persist token `@all:all` or
 * bare `@all` at a word boundary. Must not match `@allison` or `@all:other`.
 */
export function contentIncludesRoomAllMention(content: string): boolean {
  const normalized = unwrapRoomAllMentionMarkdown(content);
  if (/(?:^|\s)@all:all(?=$|[\s.,!?;:])/.test(normalized)) {
    return true;
  }
  // Bare form must not treat `@all:other` as a match (colon form handled above).
  return /(?:^|\s)@all(?=$|[\s.,!?;])/.test(normalized);
}

/**
 * Resolve human @mentions for a room message. Candidates must already be room
 * members. The author is always excluded. Unlike coworkers, these IDs do not
 * create ChatRoomMention rows or trigger AI dispatch — they address humans via
 * content tokens; callers emit in-app notifications after the message commits.
 *
 * When content includes `@all` / `@all:all`, every room human except the author
 * is included. Explicit id `"all"` is ignored (not a room user).
 */
export function resolveMentionedUserIds(params: {
  content: string;
  explicitUserIds?: readonly string[];
  roomUsers: Array<{ id: string; name: string }>;
  excludeUserId?: string | null;
}): string[] {
  const excluded = params.excludeUserId ?? null;
  const roomUserIds = new Set(
    params.roomUsers.map((user) => user.id).filter((id) => id !== excluded),
  );
  const mentionedIds = new Set(
    normalizeUniqueStrings(params.explicitUserIds ?? []).filter(
      (id) => id !== ROOM_MENTION_ALL_ID && roomUserIds.has(id),
    ),
  );

  if (contentIncludesRoomAllMention(params.content)) {
    for (const userId of roomUserIds) {
      mentionedIds.add(userId);
    }
  }

  const idTokenRegex = /@([^\s:]+):([^\s]+)/g;
  for (const match of params.content.matchAll(idTokenRegex)) {
    const id = match[1];
    if (id && id !== ROOM_MENTION_ALL_ID && roomUserIds.has(id)) {
      mentionedIds.add(id);
    }
  }

  for (const user of params.roomUsers) {
    if (user.id === excluded) {
      continue;
    }
    const aliases = new Set([slugifyRoomName(user.name)]);
    for (const alias of aliases) {
      // Reserved `@all` is owned by contentIncludesRoomAllMention, not name alias.
      if (alias === ROOM_MENTION_ALL_ID) {
        continue;
      }
      const aliasRegex = new RegExp(
        `(^|\\s)@${escapeRegExp(alias)}(?=$|[\\s.,!?;:])`,
        "i",
      );
      if (aliasRegex.test(params.content)) {
        mentionedIds.add(user.id);
      }
    }
  }

  return [...mentionedIds].filter((userId) => roomUserIds.has(userId));
}
