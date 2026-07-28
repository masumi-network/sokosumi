import type { Prisma } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";

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

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const AFK_WINDOW_MS = 30 * 60 * 1000;

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
  if (idleMs <= ONLINE_WINDOW_MS) {
    return "online";
  }
  if (idleMs <= AFK_WINDOW_MS) {
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

export function mapChatRoom(
  room: ChatRoomWithMembers,
  currentUserId?: string,
  unreadCount = 0,
) {
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
    updatedAt: room.updatedAt,
    unreadCount,
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
    { count: number; reactedByCurrentUser: boolean }
  >();
  for (const reaction of message.reactions) {
    const current = reactionCounts.get(reaction.emoji) ?? {
      count: 0,
      reactedByCurrentUser: false,
    };
    current.count += 1;
    current.reactedByCurrentUser =
      current.reactedByCurrentUser || reaction.userId === currentUserId;
    reactionCounts.set(reaction.emoji, current);
  }

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
      }),
    ),
    threadReplyCount: message._count.replies,
    threadLastReplyAt: message.replies[0]?.createdAt ?? null,
    metadata: (message.metadata as Record<string, unknown> | null) ?? null,
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

// Write paths only need the room's identity plus the coworker roster used
// for mention dispatch. Hydrating the full include here would pull every user
// member, their user rows, and a session-presence lookup into the write
// transaction — hundreds of unused rows per message on a large room.
const chatRoomWriteSelect = {
  id: true,
  organizationId: true,
  slug: true,
  kind: true,
  providerConversationId: true,
  userMembers: {
    select: {
      userId: true,
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
