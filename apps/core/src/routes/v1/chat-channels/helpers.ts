import type { Prisma } from "@sokosumi/database";

import { badRequest, notFound } from "@/helpers/error";
import { resolveMemberOrganizationById } from "@/helpers/organization";

export const chatChannelUserSelect = {
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

export const chatChannelCoworkerSelect = {
  id: true,
  name: true,
  slug: true,
  caption: true,
  image: true,
} as const satisfies Prisma.CoworkerSelect;

type ChatChannelPresence = "online" | "afk" | "offline";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const AFK_WINDOW_MS = 30 * 60 * 1000;

export const chatChannelInclude = {
  userMembers: {
    include: {
      user: { select: chatChannelUserSelect },
    },
    orderBy: { createdAt: "asc" },
  },
  coworkerMembers: {
    include: {
      coworker: { select: chatChannelCoworkerSelect },
    },
    orderBy: { createdAt: "asc" },
  },
} as const satisfies Prisma.ChatChannelInclude;

export const chatChannelMessageInclude = {
  senderUser: { select: chatChannelUserSelect },
  senderCoworker: { select: chatChannelCoworkerSelect },
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
} as const satisfies Prisma.ChatChannelMessageInclude;

type ChatChannelWithMembers = Prisma.ChatChannelGetPayload<{
  include: typeof chatChannelInclude;
}>;

type ChatChannelMessageWithSender = Prisma.ChatChannelMessageGetPayload<{
  include: typeof chatChannelMessageInclude;
}>;

function resolveUserPresence(
  user: Pick<ChatChannelWithMembers["userMembers"][number]["user"], "id"> & {
    sessions: Array<{ expiresAt: Date; updatedAt: Date }>;
  },
  currentUserId?: string,
): ChatChannelPresence {
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

export async function getChatChannelUnreadCounts(
  channelIds: readonly string[],
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<Map<string, number>> {
  const uniqueChannelIds = normalizeUniqueStrings(channelIds);
  if (uniqueChannelIds.length === 0) {
    return new Map();
  }

  const channelIdPlaceholders = uniqueChannelIds
    .map((_, index) => `$${index + 1}::uuid`)
    .join(", ");
  const userIdPlaceholder = `$${uniqueChannelIds.length + 1}`;

  const rows = await tx.$queryRawUnsafe<
    Array<{ channelId: string; unreadCount: number | bigint }>
  >(
    `
    SELECT
      message."channelId" AS "channelId",
      COUNT(*)::int AS "unreadCount"
    FROM "chat_channel_message" message
    LEFT JOIN "chat_channel_read_state" read_state
      ON read_state."channelId" = message."channelId"
      AND read_state."userId" = ${userIdPlaceholder}
    WHERE message."channelId" IN (${channelIdPlaceholders})
      AND message."createdAt" > COALESCE(read_state."lastReadAt", '-infinity'::timestamp)
      AND (message."senderUserId" IS NULL OR message."senderUserId" <> ${userIdPlaceholder})
    GROUP BY message."channelId"
  `,
    ...uniqueChannelIds,
    userId,
  );

  return new Map(rows.map((row) => [row.channelId, Number(row.unreadCount)]));
}

export function mapChatChannel(
  channel: ChatChannelWithMembers,
  currentUserId?: string,
  unreadCount = 0,
) {
  return {
    id: channel.id,
    organizationId: channel.organizationId,
    name: channel.name,
    slug: channel.slug,
    kind: channel.kind as "channel" | "direct",
    directKey: channel.directKey,
    topic: channel.topic,
    createdByUserId: channel.createdByUserId,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    unreadCount,
    userMembers: channel.userMembers.map(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      presence: resolveUserPresence(user, currentUserId),
    })),
    coworkerMembers: channel.coworkerMembers.map(({ coworker }) => ({
      id: coworker.id,
      name: coworker.name,
      slug: coworker.slug,
      caption: coworker.caption ?? null,
      image: coworker.image ?? null,
      presence: "online" as const,
    })),
  };
}

export function mapChatChannelMessage(
  message: ChatChannelMessageWithSender,
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
    channelId: message.channelId,
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

export function slugifyChannelName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "channel";
}

export function buildDirectChannelKey(
  userIdA: string,
  userIdB: string,
): string {
  return [userIdA, userIdB].sort().join(":");
}

export function buildDirectCoworkerChannelKey(
  userId: string,
  coworkerId: string,
): string {
  return `coworker:${userId}:${coworkerId}`;
}

export function buildDirectParticipantChannelKey(params: {
  currentUserId: string;
  memberUserIds: readonly string[];
  coworkerIds: readonly string[];
}): string {
  const memberUserIds = normalizeUniqueStrings(params.memberUserIds);
  const coworkerIds = normalizeUniqueStrings(params.coworkerIds);

  if (memberUserIds.length === 1 && coworkerIds.length === 0) {
    return buildDirectChannelKey(params.currentUserId, memberUserIds[0]);
  }

  if (memberUserIds.length === 0 && coworkerIds.length === 1) {
    return buildDirectCoworkerChannelKey(params.currentUserId, coworkerIds[0]);
  }

  const participantKeys = [
    ...normalizeUniqueStrings([params.currentUserId, ...memberUserIds]).map(
      (userId) => `user:${userId}`,
    ),
    ...coworkerIds.map((coworkerId) => `coworker:${coworkerId}`),
  ].sort();

  return `direct:v2:${participantKeys.join(":")}`;
}

export function buildDirectChannelName(names: readonly string[]): string {
  const cleanNames = normalizeUniqueStrings(names);

  if (cleanNames.length === 0) {
    return "Direct message";
  }

  if (cleanNames.length <= 3) {
    return cleanNames.join(", ");
  }

  return `${cleanNames.slice(0, 3).join(", ")} and ${cleanNames.length - 3} more`;
}

export async function buildUniqueChannelSlug(
  organizationId: string,
  name: string,
  tx: Prisma.TransactionClient,
): Promise<string> {
  const baseSlug = slugifyChannelName(name);
  const existing = await tx.chatChannel.findMany({
    where: {
      organizationId,
      slug: {
        startsWith: baseSlug,
      },
    },
    select: { slug: true },
  });
  const used = new Set(existing.map((channel) => channel.slug));
  if (!used.has(baseSlug)) {
    return baseSlug;
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw badRequest("Could not create a unique channel slug");
}

export async function requireChatChannelUserAccess(
  channelId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<ChatChannelWithMembers> {
  const channel = await tx.chatChannel.findFirst({
    where: {
      id: channelId,
      archivedAt: null,
      userMembers: {
        some: { userId },
      },
    },
    include: chatChannelInclude,
  });

  if (!channel) {
    throw notFound("Channel not found");
  }

  await resolveMemberOrganizationById({
    id: channel.organizationId,
    userId,
    tx,
  });

  return channel;
}

// Write paths only need the channel's identity plus the coworker roster used
// for mention dispatch. Hydrating the full include here would pull every user
// member, their user rows, and a session-presence lookup into the write
// transaction — hundreds of unused rows per message on a large channel.
const chatChannelWriteSelect = {
  id: true,
  organizationId: true,
  slug: true,
  kind: true,
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
} as const satisfies Prisma.ChatChannelSelect;

type ChatChannelForWrite = Prisma.ChatChannelGetPayload<{
  select: typeof chatChannelWriteSelect;
}>;

export async function requireChatChannelUserWriteAccess(
  channelId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<ChatChannelForWrite> {
  const channel = await tx.chatChannel.findFirst({
    where: {
      id: channelId,
      archivedAt: null,
      userMembers: {
        some: { userId },
      },
    },
    select: chatChannelWriteSelect,
  });

  if (!channel) {
    throw notFound("Channel not found");
  }

  await resolveMemberOrganizationById({
    id: channel.organizationId,
    userId,
    tx,
  });

  return channel;
}

export async function requireChatChannelUserMembership(
  channelId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<{ id: string; organizationId: string }> {
  const channel = await tx.chatChannel.findFirst({
    where: {
      id: channelId,
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

  if (!channel) {
    throw notFound("Channel not found");
  }

  await resolveMemberOrganizationById({
    id: channel.organizationId,
    userId,
    tx,
  });

  return channel;
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
    throw badRequest("Channel human members must belong to the organization");
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
    throw badRequest("Channel AI coworkers must be active chat coworkers");
  }

  return uniqueCoworkerIds;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveMentionedCoworkerIds(params: {
  content: string;
  explicitCoworkerIds?: readonly string[];
  channelCoworkers: Array<{ id: string; name: string; slug: string }>;
}): string[] {
  const channelCoworkerIds = new Set(
    params.channelCoworkers.map((coworker) => coworker.id),
  );
  const mentionedIds = new Set(
    normalizeUniqueStrings(params.explicitCoworkerIds ?? []).filter((id) =>
      channelCoworkerIds.has(id),
    ),
  );

  const slugToId = new Map(
    params.channelCoworkers.map((coworker) => [coworker.slug, coworker.id]),
  );

  const tokenRegex = /@coworker:([a-z0-9][a-z0-9-]*)/gi;
  for (const match of params.content.matchAll(tokenRegex)) {
    const slug = match[1]?.toLowerCase();
    const id = slug ? slugToId.get(slug) : null;
    if (id) {
      mentionedIds.add(id);
    }
  }

  for (const coworker of params.channelCoworkers) {
    const aliases = new Set([
      coworker.slug.toLowerCase(),
      slugifyChannelName(coworker.name),
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

  const allowedIds = new Set(params.channelCoworkers.map(({ id }) => id));
  return [...mentionedIds].filter((coworkerId) => allowedIds.has(coworkerId));
}
