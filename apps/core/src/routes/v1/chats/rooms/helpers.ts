import { MemberRole, NotificationKind, type Prisma } from "@sokosumi/database";
import {
  buildRoomQuoteSnippetParts,
  CHAT_PRESENCE_AFK_WINDOW_MS,
  CHAT_PRESENCE_ONLINE_WINDOW_MS,
} from "@sokosumi/utils";

import { badRequest, notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import {
  type ChatRoomMessageQuote,
  MAX_LISTED_CHAT_REACTION_REACTORS,
} from "@/schemas/chat-room.schema";

export const chatRoomUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  sessions: {
    select: {
      expiresAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 1,
  },
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
    orderBy: { createdAt: "asc" },
  },
  coworkerMembers: {
    include: {
      coworker: { select: chatRoomCoworkerSelect },
    },
    orderBy: { createdAt: "asc" },
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
  replies: {
    select: {
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  _count: {
    select: {
      replies: true,
    },
  },
} as const satisfies Prisma.ChatRoomMessageInclude;

type ChatRoomWithMembers = Prisma.ChatRoomGetPayload<{
  include: typeof chatRoomInclude;
}>;

type ChatRoomMessageWithSender = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

function resolveUserPresence(
  user: Pick<ChatRoomWithMembers["userMembers"][number]["user"], "id"> & {
    sessions: Array<{ expiresAt: Date; updatedAt: Date }>;
  },
  currentUserId?: string,
): ChatRoomPresence {
  if (user.id === currentUserId) {
    return "online";
  }

  const activeSession = user.sessions.find(
    (session) => session.expiresAt.getTime() > Date.now(),
  );
  if (!activeSession) {
    return "offline";
  }

  const idleMs = Date.now() - activeSession.updatedAt.getTime();
  if (idleMs <= CHAT_PRESENCE_ONLINE_WINDOW_MS) {
    return "online";
  }
  if (idleMs <= CHAT_PRESENCE_AFK_WINDOW_MS) {
    return "afk";
  }
  return "offline";
}

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
      message."roomId" AS "roomId",
      COUNT(*)::int AS "unreadCount"
    FROM "chat_room_message" message
    LEFT JOIN "chat_room_read_state" read_state
      ON read_state."roomId" = message."roomId"
      AND read_state."userId" = ${userIdPlaceholder}
    WHERE message."roomId" IN (${roomIdPlaceholders})
      AND message."createdAt" > COALESCE(read_state."lastReadAt", '-infinity'::timestamp)
      AND (message."senderUserId" IS NULL OR message."senderUserId" <> ${userIdPlaceholder})
    GROUP BY message."roomId"
  `,
    ...uniqueRoomIds,
    userId,
  );

  return new Map(rows.map((row) => [row.roomId, Number(row.unreadCount)]));
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
}

export function mapChatRoom(
  room: ChatRoomWithMembers,
  currentUserId?: string,
  attention: MapChatRoomAttentionOptions = {},
) {
  const { unreadCount = 0, unreadMentionCount = 0, lastActivityAt } = attention;

  return {
    id: room.id,
    organizationId: room.organizationId,
    name: room.name,
    slug: room.slug,
    kind: room.kind as "channel" | "direct",
    directKey: room.directKey,
    topic: room.topic,
    createdByUserId: room.createdByUserId,
    createdAt: room.createdAt,
    updatedAt: lastActivityAt ?? room.updatedAt,
    unreadCount,
    unreadMentionCount,
    userMembers: room.userMembers.map(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      presence: resolveUserPresence(user, currentUserId),
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

  return {
    id: message.id,
    roomId: message.roomId,
    parentMessageId: message.parentMessageId,
    content: message.content,
    createdAt: message.createdAt,
    sender,
    mentions: message.mentionsAsSource.map((mention) => ({
      id: mention.id,
      coworkerId: mention.coworkerId,
      status: mention.status,
      responseMessageId: mention.responseMessageId,
    })),
    reactions: Array.from(reactionCounts.entries()).map(
      ([emoji, reaction]) => ({
        emoji,
        count: reaction.count,
        reactedByCurrentUser: reaction.reactedByCurrentUser,
        reactors: reaction.reactors,
      }),
    ),
    threadReplyCount: message._count.replies,
    threadLastReplyAt: message.replies[0]?.createdAt ?? null,
    metadata,
    quote: readQuoteFromMetadata(metadata),
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
    },
    select: {
      id: true,
      content: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
    },
  });

  if (!quoted) {
    throw badRequest("Quoted message not found");
  }

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
 * Archive and restore hide or resurface a room for everyone, so only the
 * creator or an organization owner/admin may do either. Plain members leave
 * instead (or ask someone elevated to archive).
 */
export function canManageChatRoomLifecycle(options: {
  createdByUserId: string;
  userId: string;
  /** Organization membership role from Prisma (`string`); compare to `MemberRole`. */
  role: string;
}): boolean {
  return (
    options.createdByUserId === options.userId ||
    options.role === MemberRole.OWNER ||
    options.role === MemberRole.ADMIN
  );
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

  await assertRoomOrganizationAccess(room.organizationId, userId, tx);

  return room;
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

  await assertRoomOrganizationAccess(room.organizationId, userId, tx);

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
      user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
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
    orderBy: { createdAt: "asc" },
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

  await assertRoomOrganizationAccess(room.organizationId, userId, tx);

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
    },
  });

  if (!room) {
    throw notFound("Room not found");
  }

  await assertRoomOrganizationAccess(room.organizationId, userId, tx);

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

export async function validateChatCoworkerIds(
  coworkerIds: readonly string[],
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const uniqueCoworkerIds = normalizeUniqueStrings(coworkerIds);
  if (uniqueCoworkerIds.length === 0) {
    return [];
  }

  const coworkers = await tx.coworker.findMany({
    where: {
      id: { in: uniqueCoworkerIds },
      archivedAt: null,
      isWhitelisted: true,
      baseURL: { not: null },
      capabilities: { has: "chat" },
    },
    select: { id: true },
  });
  const found = new Set(coworkers.map((coworker) => coworker.id));
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
