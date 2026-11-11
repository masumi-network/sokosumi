import { randomUUID } from "node:crypto";
import type { BuzzIdentity } from "@sokosumi/database";
import { npubEncode, nsecEncode } from "nostr-tools/nip19";
import type { Event } from "nostr-tools/pure";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { getEnv } from "@/config/env";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import {
  BUZZ_KIND,
  channelIdOf,
  channelMembersDraft,
  communityMemberDraft,
  contentHash,
  createChannelDraft,
  deletionDraft,
  type EventDraft,
  editDraft,
  MAX_DIRECT_MESSAGE_PEOPLE,
  messageDraft,
  openDirectMessageDraft,
  openedDirectMessageChannelId,
  profileDraft,
  reactionDraft,
  readableContent,
  readInbound,
} from "@/lib/buzz/events";
import {
  BuzzRelayRejectedError,
  publishSignedEvent,
  queryEvents,
  signEvent,
} from "@/lib/buzz/relay-client";
import { openSecret, sealSecret } from "@/lib/buzz/secret-box";
import prisma from "@/lib/db/prisma";

/**
 * Buzz bridge: every chat room of an organization on Buzz is also a Buzz
 * channel, so its members can chat from Sokosumi or from any Buzz client.
 *
 * Out: Core records which messages changed ({@link enqueueBuzzSync}); the
 * bridge worker brings each one's Buzz copy up to date
 * ({@link reconcileMessage}), signed by the person, bot or coworker who wrote
 * it.
 * In: the worker reads the relay and replays what Buzz users did through
 * Core's own chat routes as them ({@link applyInboundEvent}), so a message
 * from Buzz gets mentions, bot replies and notifications like any other.
 *
 * Links are written before an event is sent, so the bridge always knows its
 * own echo.
 */

export interface BuzzConfig {
  communityUrlTemplate: string;
  operatorSecretKey: Uint8Array;
  operatorPubkey: string;
  encryptionSecret: string;
}

export function buzzConfig(): BuzzConfig | null {
  const env = getEnv();
  if (
    !env.BUZZ_COMMUNITY_URL_TEMPLATE ||
    !env.BUZZ_OPERATOR_SECRET_KEY ||
    !env.BUZZ_KEY_ENCRYPTION_SECRET
  ) {
    return null;
  }
  const operatorSecretKey = Uint8Array.from(
    Buffer.from(env.BUZZ_OPERATOR_SECRET_KEY, "hex"),
  );
  return {
    communityUrlTemplate: env.BUZZ_COMMUNITY_URL_TEMPLATE,
    operatorSecretKey,
    operatorPubkey: getPublicKey(operatorSecretKey),
    encryptionSecret: env.BUZZ_KEY_ENCRYPTION_SECRET,
  };
}

function requireConfig(): BuzzConfig {
  const config = buzzConfig();
  if (!config) throw new Error("Buzz bridge is not configured");
  return config;
}

/** Event outcomes that mean "the relay already has this state". */
function isAlreadyDone(error: unknown): boolean {
  return (
    error instanceof BuzzRelayRejectedError &&
    /duplicate|already|exists/i.test(error.reason)
  );
}

async function publish(
  relayUrl: string,
  secretKey: Uint8Array,
  draft: EventDraft,
): Promise<Event> {
  const event = signEvent(draft, secretKey);
  await publishSignedEvent({ relayUrl, event, secretKey });
  return event;
}

// ---------------------------------------------------------------- identities

type IdentityOwner =
  | { userId: string }
  | { sokoBotId: string }
  | { coworkerId: string };

export async function ensureIdentity(
  owner: IdentityOwner,
): Promise<BuzzIdentity> {
  const existing = await prisma.buzzIdentity.findUnique({ where: owner });
  if (existing) return existing;
  const secretKey = generateSecretKey();
  try {
    return await prisma.buzzIdentity.create({
      data: {
        ...owner,
        pubkey: getPublicKey(secretKey),
        encryptedSecretKey: sealSecret(
          Buffer.from(secretKey).toString("hex"),
          requireConfig().encryptionSecret,
        ),
      },
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    return prisma.buzzIdentity.findUniqueOrThrow({ where: owner });
  }
}

export function identitySecretKey(identity: BuzzIdentity): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      openSecret(identity.encryptedSecretKey, requireConfig().encryptionSecret),
      "hex",
    ),
  );
}

/** What a person needs to sign in to their organizations from a Buzz client. */
export async function buzzConnectionFor(userId: string) {
  const config = buzzConfig();
  if (!config) return null;
  const memberships = await prisma.member.findMany({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          buzzCommunity: { select: { relayUrl: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const communities = memberships.flatMap(({ organization }) =>
    organization.buzzCommunity
      ? [
          {
            organizationId: organization.id,
            organizationName: organization.name,
            relayUrl: organization.buzzCommunity.relayUrl,
          },
        ]
      : [],
  );
  // Owners and admins can put an organization that is not on Buzz yet on it.
  const canEnable = memberships.flatMap(({ role, organization }) =>
    !organization.buzzCommunity && (role === "owner" || role === "admin")
      ? [
          {
            organizationId: organization.id,
            organizationName: organization.name,
          },
        ]
      : [],
  );
  if (communities.length === 0) {
    return { identity: null, communities, canEnable };
  }
  const identity = await ensureIdentity({ userId });
  return {
    identity: { pubkey: identity.pubkey, npub: npubEncode(identity.pubkey) },
    communities,
    canEnable,
  };
}

/** The secret key, for importing into a Buzz client. */
export async function exportBuzzSecretKey(userId: string): Promise<string> {
  const identity = await ensureIdentity({ userId });
  return nsecEncode(identitySecretKey(identity));
}

// ---------------------------------------------------------------- enabling

export function communityUrlFor(slug: string): string {
  return requireConfig().communityUrlTemplate.replaceAll("{slug}", slug);
}

export async function enableBuzzForOrganization(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { slug: true },
  });
  return prisma.buzzCommunity.upsert({
    where: { organizationId },
    create: { organizationId, relayUrl: communityUrlFor(organization.slug) },
    update: {},
  });
}

// ---------------------------------------------------------------- outbound

/**
 * Note that a message's Buzz copy may be stale. Cheap and never throws: a
 * chat write must not fail because Buzz is unreachable.
 */
export async function enqueueBuzzSync(input: {
  roomId: string;
  messageId: string | null;
}): Promise<void> {
  try {
    if (!buzzConfig()) return;
    if (!(await buzzCommunityForRoom(input.roomId))) return;
    await prisma.buzzOutbox.create({
      data: { roomId: input.roomId, messageId: input.messageId },
    });
  } catch (error) {
    console.error("Failed to enqueue Buzz sync", error);
  }
}

/**
 * The community a room lives in on Buzz: its organization's, or for a Direct
 * (which belongs to no organization), the oldest Buzz community all its people
 * are members of. Null when the room stays Sokosumi-only.
 */
export async function buzzCommunityForRoom(roomId: string) {
  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: {
      kind: true,
      buzzChannel: { select: { community: true } },
      organization: { select: { buzzCommunity: true } },
      userMembers: { select: { userId: true } },
    },
  });
  if (!room) return null;
  if (room.buzzChannel) return room.buzzChannel.community;
  if (room.organization) return room.organization.buzzCommunity;
  if (room.kind !== "direct" || room.userMembers.length === 0) return null;
  return prisma.buzzCommunity.findFirst({
    where: {
      AND: room.userMembers.map((member) => ({
        organization: { members: { some: { userId: member.userId } } },
      })),
    },
    orderBy: { createdAt: "asc" },
  });
}

const roomForSync = {
  id: true,
  name: true,
  topic: true,
  kind: true,
  buzzChannel: true,
  userMembers: {
    select: {
      userId: true,
      user: { select: { name: true, image: true } },
    },
  },
  sokoBotMembers: {
    select: {
      sokoBotId: true,
      sokoBot: { select: { name: true, avatarImageUrl: true } },
    },
  },
  coworkerMembers: {
    select: {
      coworkerId: true,
      coworker: { select: { name: true, image: true } },
    },
  },
} as const;

async function ensureCommunityMember(
  communityId: string,
  relayUrl: string,
  identity: BuzzIdentity,
) {
  const known = await prisma.buzzCommunityMember.findUnique({
    where: {
      communityId_identityId: { communityId, identityId: identity.id },
    },
  });
  if (known) return;
  try {
    await publish(
      relayUrl,
      requireConfig().operatorSecretKey,
      communityMemberDraft(identity.pubkey),
    );
  } catch (error) {
    if (!isAlreadyDone(error)) throw error;
  }
  await prisma.buzzCommunityMember.upsert({
    where: {
      communityId_identityId: { communityId, identityId: identity.id },
    },
    create: { communityId, identityId: identity.id },
    update: {},
  });
}

async function ensureProfile(
  relayUrl: string,
  identity: BuzzIdentity,
  profile: { name: string; picture?: string | null; bot?: boolean },
) {
  const draft = profileDraft(profile);
  const hash = contentHash(`${relayUrl}\n${draft.content}`);
  if (identity.profileHash === hash) return;
  await publish(relayUrl, identitySecretKey(identity), draft);
  await prisma.buzzIdentity.update({
    where: { id: identity.id },
    data: { profileHash: hash },
  });
}

function channelName(room: { name: string }): string {
  return room.name.trim() || "Chat";
}

const operatorProfiles = new Set<string>();

/** The relay owner signs channel administration; Buzz shows it as Sokosumi. */
async function ensureOperatorProfile(relayUrl: string) {
  if (operatorProfiles.has(relayUrl)) return;
  await publish(
    relayUrl,
    requireConfig().operatorSecretKey,
    profileDraft({ name: "Sokosumi", bot: true }),
  );
  operatorProfiles.add(relayUrl);
}

/**
 * Makes the room's Buzz channel match the room: it exists, everyone in the
 * room is a community member with a profile, and the channel's members are
 * the room's members.
 */
export async function syncRoomChannel(roomId: string) {
  const config = requireConfig();
  const room = await prisma.chatRoom.findUniqueOrThrow({
    where: { id: roomId },
    select: roomForSync,
  });
  const community = await buzzCommunityForRoom(room.id);
  if (!community) return null;
  const relayUrl = community.relayUrl;

  const members: { identity: BuzzIdentity; role: "member" | "bot" }[] = [];
  for (const member of room.userMembers) {
    const identity = await ensureIdentity({ userId: member.userId });
    await ensureCommunityMember(community.id, relayUrl, identity);
    await ensureProfile(relayUrl, identity, {
      name: member.user.name,
      picture: member.user.image,
    });
    members.push({ identity, role: "member" });
  }
  for (const member of room.sokoBotMembers) {
    const identity = await ensureIdentity({ sokoBotId: member.sokoBotId });
    await ensureCommunityMember(community.id, relayUrl, identity);
    await ensureProfile(relayUrl, identity, {
      name: sokoBotDisplayName(member.sokoBot),
      picture: member.sokoBot.avatarImageUrl,
      bot: true,
    });
    members.push({ identity, role: "bot" });
  }
  for (const member of room.coworkerMembers) {
    const identity = await ensureIdentity({ coworkerId: member.coworkerId });
    await ensureCommunityMember(community.id, relayUrl, identity);
    await ensureProfile(relayUrl, identity, {
      name: member.coworker.name,
      picture: member.coworker.image,
      bot: true,
    });
    members.push({ identity, role: "bot" });
  }

  // A Direct of up to nine is a Buzz DM, so Buzz lists it with the DMs. Its
  // people are fixed: the participant set is what identifies a Buzz DM.
  const asDirectMessage =
    room.kind === "direct" &&
    members.length >= 2 &&
    members.length <= MAX_DIRECT_MESSAGE_PEOPLE;

  let channel = room.buzzChannel;
  if (!channel && asDirectMessage) {
    const [opener, ...others] = members;
    const event = signEvent(
      openDirectMessageDraft(others.map((member) => member.identity.pubkey)),
      identitySecretKey(opener.identity),
    );
    const { message } = await publishSignedEvent({
      relayUrl,
      event,
      secretKey: identitySecretKey(opener.identity),
    });
    const channelId = openedDirectMessageChannelId(message);
    if (!channelId) throw new Error(`Buzz did not open the DM: ${message}`);
    channel = await prisma.buzzChannel.create({
      data: {
        roomId: room.id,
        communityId: community.id,
        channelId,
        membersHash: "direct",
      },
    });
  }
  if (!channel) {
    await ensureOperatorProfile(relayUrl);
    const channelId = randomUUID();
    await publish(
      relayUrl,
      config.operatorSecretKey,
      createChannelDraft({
        channelId,
        name: channelName(room),
        about: room.topic,
      }),
    );
    channel = await prisma.buzzChannel.create({
      data: { roomId: room.id, communityId: community.id, channelId },
    });
  }
  if (channel.membersHash === "direct") return { channel, relayUrl };

  const wanted = new Map(
    members.map((member) => [member.identity.pubkey, member.role]),
  );
  const membersHash = contentHash(
    [...wanted.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pubkey, role]) => `${pubkey}:${role}`)
      .join(","),
  );
  if (channel.membersHash !== membersHash) {
    const current = await channelMemberPubkeys(relayUrl, channel.channelId);
    const toAdd = [...wanted.entries()]
      .filter(([pubkey]) => !current.has(pubkey))
      .map(([pubkey, role]) => ({ pubkey, role }));
    const toRemove = [...current]
      .filter(
        (pubkey) => !wanted.has(pubkey) && pubkey !== config.operatorPubkey,
      )
      .map((pubkey) => ({ pubkey }));
    if (toAdd.length > 0) {
      await publish(
        relayUrl,
        config.operatorSecretKey,
        channelMembersDraft({
          channelId: channel.channelId,
          kind: BUZZ_KIND.addMember,
          members: toAdd,
        }),
      );
    }
    for (const member of toRemove) {
      await publish(
        relayUrl,
        config.operatorSecretKey,
        channelMembersDraft({
          channelId: channel.channelId,
          kind: BUZZ_KIND.removeMember,
          members: [member],
        }),
      );
    }
    channel = await prisma.buzzChannel.update({
      where: { id: channel.id },
      data: { membersHash },
    });
  }
  return { channel, relayUrl };
}

async function channelMemberPubkeys(
  relayUrl: string,
  channelId: string,
): Promise<Set<string>> {
  const [list] = await queryEvents({
    relayUrl,
    secretKey: requireConfig().operatorSecretKey,
    filters: [{ kinds: [39002], "#d": [channelId], limit: 1 }],
  });
  return new Set(
    (list?.tags ?? [])
      .filter((tag) => tag[0] === "p" && typeof tag[1] === "string")
      .map((tag) => tag[1] as string),
  );
}

const messageForSync = {
  id: true,
  roomId: true,
  parentMessageId: true,
  content: true,
  createdAt: true,
  deletedAt: true,
  clientMessageId: true,
  senderUserId: true,
  senderSokoBotId: true,
  senderCoworkerId: true,
  buzzLink: true,
  reactions: { select: { userId: true, emoji: true } },
  userMentionsAsSource: { select: { userId: true } },
  mentionsAsSource: { select: { sokoBotId: true, coworkerId: true } },
} as const;

function authorOf(message: {
  senderUserId: string | null;
  senderSokoBotId: string | null;
  senderCoworkerId: string | null;
}): IdentityOwner | null {
  if (message.senderUserId) return { userId: message.senderUserId };
  if (message.senderSokoBotId) return { sokoBotId: message.senderSokoBotId };
  if (message.senderCoworkerId) return { coworkerId: message.senderCoworkerId };
  return null;
}

export type ReconcileResult =
  | "published"
  | "edited"
  | "deleted"
  | "linked"
  | "unchanged"
  | "skipped";

/** Brings one message's Buzz copy (and its reactions) up to date. */
export async function reconcileMessage(
  messageId: string,
  depth = 0,
): Promise<ReconcileResult> {
  const message = await prisma.chatRoomMessage.findUnique({
    where: { id: messageId },
    select: messageForSync,
  });
  if (!message) return "skipped";
  // First, so a membership notice ("X joined") brings the members along.
  const synced = await syncRoomChannel(message.roomId);
  if (!synced) return "skipped";
  const author = authorOf(message);
  // Timeline notices have no author; Buzz posts its own.
  if (!author) return "skipped";
  const { channel, relayUrl } = synced;
  const authorIdentity = await ensureIdentity(author);
  const authorKey = identitySecretKey(authorIdentity);
  const hash = contentHash(message.content);
  let result: ReconcileResult = "unchanged";
  let link = message.buzzLink;

  if (!link) {
    if (message.deletedAt) return "skipped";
    if (message.clientMessageId?.startsWith("buzz:")) {
      // Posted from Buzz: the event already exists.
      link = await prisma.buzzMessageLink.create({
        data: {
          messageId: message.id,
          eventId: message.clientMessageId.slice("buzz:".length),
          contentHash: hash,
        },
      });
      result = "linked";
    } else {
      // A reply still streaming has no text yet; its next update brings it.
      if (!message.content.trim()) return "skipped";
      let threadRootEventId: string | null = null;
      if (message.parentMessageId) {
        const parentLink = await prisma.buzzMessageLink.findUnique({
          where: { messageId: message.parentMessageId },
        });
        if (!parentLink && depth === 0) {
          await reconcileMessage(message.parentMessageId, depth + 1);
        }
        threadRootEventId =
          parentLink?.eventId ??
          (
            await prisma.buzzMessageLink.findUnique({
              where: { messageId: message.parentMessageId },
            })
          )?.eventId ??
          null;
      }
      const mentionPubkeys = await mentionPubkeysOf(message);
      const event = signEvent(
        messageDraft({
          channelId: channel.channelId,
          content: message.content,
          threadRootEventId,
          mentionPubkeys,
        }),
        authorKey,
      );
      link = await prisma.buzzMessageLink.create({
        data: { messageId: message.id, eventId: event.id, contentHash: hash },
      });
      try {
        await publishSignedEvent({ relayUrl, event, secretKey: authorKey });
      } catch (error) {
        if (!isAlreadyDone(error)) {
          await prisma.buzzMessageLink.delete({
            where: { messageId: message.id },
          });
          throw error;
        }
      }
      result = "published";
    }
  } else if (message.deletedAt && !link.deleted) {
    await prisma.buzzMessageLink.update({
      where: { messageId: message.id },
      data: { deleted: true },
    });
    await publish(
      relayUrl,
      authorKey,
      deletionDraft({ channelId: channel.channelId, eventId: link.eventId }),
    );
    return "deleted";
  } else if (!message.deletedAt && link.contentHash !== hash) {
    const previous = link.contentHash;
    await prisma.buzzMessageLink.update({
      where: { messageId: message.id },
      data: { contentHash: hash },
    });
    try {
      await publish(
        relayUrl,
        authorKey,
        editDraft({
          channelId: channel.channelId,
          eventId: link.eventId,
          content: message.content,
        }),
      );
    } catch (error) {
      await prisma.buzzMessageLink.update({
        where: { messageId: message.id },
        data: { contentHash: previous },
      });
      throw error;
    }
    result = "edited";
  }

  if (!message.deletedAt) {
    await reconcileReactions({
      messageId: message.id,
      eventId: link.eventId,
      authorPubkey: authorIdentity.pubkey,
      channelId: channel.channelId,
      relayUrl,
      reactions: message.reactions,
    });
  }
  return result;
}

async function mentionPubkeysOf(message: {
  userMentionsAsSource: { userId: string }[];
  mentionsAsSource: { sokoBotId: string | null; coworkerId: string | null }[];
}): Promise<string[]> {
  const owners: IdentityOwner[] = [
    ...message.userMentionsAsSource.map((m) => ({ userId: m.userId })),
    ...message.mentionsAsSource.flatMap((m): IdentityOwner[] =>
      m.sokoBotId
        ? [{ sokoBotId: m.sokoBotId }]
        : m.coworkerId
          ? [{ coworkerId: m.coworkerId }]
          : [],
    ),
  ];
  const pubkeys: string[] = [];
  for (const owner of owners) {
    pubkeys.push((await ensureIdentity(owner)).pubkey);
  }
  return pubkeys;
}

async function reconcileReactions(input: {
  messageId: string;
  eventId: string;
  authorPubkey: string;
  channelId: string;
  relayUrl: string;
  reactions: { userId: string; emoji: string }[];
}) {
  const links = await prisma.buzzReactionLink.findMany({
    where: { messageId: input.messageId },
    include: { identity: true },
  });
  const linked = new Set(
    links.map((link) => `${link.identity.userId}\n${link.emoji}`),
  );
  const wanted = new Set(
    input.reactions.map((reaction) => `${reaction.userId}\n${reaction.emoji}`),
  );

  for (const reaction of input.reactions) {
    if (linked.has(`${reaction.userId}\n${reaction.emoji}`)) continue;
    const identity = await ensureIdentity({ userId: reaction.userId });
    const secretKey = identitySecretKey(identity);
    const event = signEvent(
      reactionDraft({
        channelId: input.channelId,
        eventId: input.eventId,
        authorPubkey: input.authorPubkey,
        emoji: reaction.emoji,
      }),
      secretKey,
    );
    try {
      await prisma.buzzReactionLink.create({
        data: {
          messageId: input.messageId,
          identityId: identity.id,
          emoji: reaction.emoji,
          eventId: event.id,
        },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) continue;
      throw error;
    }
    await publishSignedEvent({
      relayUrl: input.relayUrl,
      event,
      secretKey,
    });
  }

  for (const link of links) {
    if (wanted.has(`${link.identity.userId}\n${link.emoji}`)) continue;
    await prisma.buzzReactionLink.delete({ where: { id: link.id } });
    await publish(
      input.relayUrl,
      identitySecretKey(link.identity),
      deletionDraft({ channelId: input.channelId, eventId: link.eventId }),
    );
  }
}

/** How long a message must be quiet before it is sent, so a streaming reply goes out once. */
export const OUTBOX_SETTLE_MS = 2_000;

/**
 * Works through the outbox: each message whose last change is older than
 * {@link OUTBOX_SETTLE_MS} is reconciled once, then its rows are dropped.
 */
export async function drainBuzzOutbox(
  options: { limit?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const rows = await prisma.buzzOutbox.findMany({
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 200,
  });
  const latest = new Map<
    string,
    { createdAt: Date; ids: string[]; roomId: string; attempts: number }
  >();
  for (const row of rows) {
    const key = row.messageId ?? `room:${row.roomId}`;
    const entry = latest.get(key) ?? {
      createdAt: row.createdAt,
      ids: [],
      roomId: row.roomId,
      attempts: 0,
    };
    entry.ids.push(row.id);
    entry.attempts = Math.max(entry.attempts, row.attempts);
    if (row.createdAt > entry.createdAt) entry.createdAt = row.createdAt;
    latest.set(key, entry);
  }

  const outcomes: { key: string; result: string }[] = [];
  for (const [key, entry] of latest) {
    if (now.getTime() - entry.createdAt.getTime() < OUTBOX_SETTLE_MS) continue;
    try {
      const result = key.startsWith("room:")
        ? (await syncRoomChannel(entry.roomId))
          ? "synced"
          : "skipped"
        : await reconcileMessage(key);
      await prisma.buzzOutbox.deleteMany({ where: { id: { in: entry.ids } } });
      outcomes.push({ key, result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (entry.attempts + 1 >= 8) {
        console.error(`Buzz sync gave up on ${key}: ${reason}`);
        await prisma.buzzOutbox.deleteMany({
          where: { id: { in: entry.ids } },
        });
      } else {
        await prisma.buzzOutbox.updateMany({
          where: { id: { in: entry.ids } },
          data: { attempts: { increment: 1 }, lastError: reason.slice(0, 500) },
        });
      }
      outcomes.push({ key, result: `error: ${reason}` });
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------- inbound

/** Calls a Core route as a person, with their bridge API key. */
export type CoreRequest = (input: {
  method: "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  apiKey: string;
  body?: unknown;
}) => Promise<{ status: number; body: unknown }>;

export async function bridgeApiKeyFor(identity: BuzzIdentity) {
  const config = requireConfig();
  if (!identity.userId) throw new Error("Only people post through Core");
  if (identity.encryptedApiKey) {
    return openSecret(identity.encryptedApiKey, config.encryptionSecret);
  }
  const { auth } = await import("@/lib/auth");
  const created = await auth.api.createApiKey({
    body: {
      configId: "default",
      userId: identity.userId,
      name: "Buzz bridge",
      metadata: { purpose: "buzz-bridge" },
    },
  });
  await prisma.buzzIdentity.update({
    where: { id: identity.id },
    data: {
      encryptedApiKey: sealSecret(created.key, config.encryptionSecret),
    },
  });
  return created.key;
}

export type InboundResult =
  | "posted"
  | "edited"
  | "deleted"
  | "reacted"
  | "unreacted"
  | "echo"
  | "ignored";

async function sendAs(
  core: CoreRequest,
  identity: BuzzIdentity,
  request: Omit<Parameters<CoreRequest>[0], "apiKey">,
) {
  const response = await core({
    ...request,
    apiKey: await bridgeApiKeyFor(identity),
  });
  if (response.status >= 400 && response.status !== 409) {
    throw new Error(
      `Core ${request.method} ${request.path} → ${response.status}: ${JSON.stringify(response.body).slice(0, 300)}`,
    );
  }
  return response;
}

/** Replays one Buzz event as the person who wrote it. */
export async function applyInboundEvent(
  event: Event,
  core: CoreRequest,
): Promise<InboundResult> {
  const config = requireConfig();
  if (event.pubkey === config.operatorPubkey) return "echo";
  const channelId = channelIdOf(event);
  const change = readInbound(event);
  if (change.type === "ignore") return "ignored";

  // Our own events are linked before they are sent.
  const [messageEcho, reactionEcho] = await Promise.all([
    prisma.buzzMessageLink.findUnique({ where: { eventId: event.id } }),
    prisma.buzzReactionLink.findUnique({ where: { eventId: event.id } }),
  ]);
  if (messageEcho || reactionEcho) return "echo";

  const author = await prisma.buzzIdentity.findUnique({
    where: { pubkey: event.pubkey },
  });
  // Bots and coworkers speak only through Sokosumi; strangers are not members.
  if (!author?.userId) return "ignored";

  switch (change.type) {
    case "message": {
      const channel = channelId
        ? await prisma.buzzChannel.findUnique({ where: { channelId } })
        : null;
      if (!channel) return "ignored";
      let parentMessageId: string | undefined;
      if (change.replyToEventId) {
        const parent = await prisma.buzzMessageLink.findUnique({
          where: { eventId: change.replyToEventId },
          select: { message: { select: { id: true, parentMessageId: true } } },
        });
        // Sokosumi threads are one level deep: answer the thread's root.
        parentMessageId = parent
          ? (parent.message.parentMessageId ?? parent.message.id)
          : undefined;
      }
      const mentioned = await prisma.buzzIdentity.findMany({
        where: { pubkey: { in: change.mentionPubkeys } },
        select: {
          pubkey: true,
          userId: true,
          sokoBotId: true,
          coworkerId: true,
          user: { select: { name: true } },
          sokoBot: { select: { name: true } },
          coworker: { select: { name: true } },
        },
      });
      const names = new Map(
        mentioned.map((identity) => [
          identity.pubkey,
          identity.user?.name ??
            (identity.sokoBot ? sokoBotDisplayName(identity.sokoBot) : null) ??
            identity.coworker?.name ??
            undefined,
        ]),
      );
      const content = readableContent(change.content, (pubkey) =>
        names.get(pubkey),
      );
      await sendAs(core, author, {
        method: "POST",
        path: `/v1/chats/rooms/${channel.roomId}/messages`,
        body: {
          content,
          clientMessageId: `buzz:${event.id}`,
          ...(parentMessageId ? { parentMessageId } : {}),
          mentionedUserIds: mentioned.flatMap((m) =>
            m.userId ? [m.userId] : [],
          ),
          mentionedSokoBotIds: mentioned.flatMap((m) =>
            m.sokoBotId ? [m.sokoBotId] : [],
          ),
          mentionedCoworkerIds: mentioned.flatMap((m) =>
            m.coworkerId ? [m.coworkerId] : [],
          ),
        },
      });
      return "posted";
    }
    case "edit": {
      const link = await prisma.buzzMessageLink.findUnique({
        where: { eventId: change.targetEventId },
        select: {
          messageId: true,
          contentHash: true,
          message: { select: { roomId: true } },
        },
      });
      if (!link) return "ignored";
      const hash = contentHash(change.content);
      if (link.contentHash === hash) return "echo";
      await prisma.buzzMessageLink.update({
        where: { messageId: link.messageId },
        data: { contentHash: hash },
      });
      await sendAs(core, author, {
        method: "PATCH",
        path: `/v1/chats/rooms/${link.message.roomId}/messages/${link.messageId}`,
        body: { content: change.content },
      });
      return "edited";
    }
    case "delete": {
      let result: InboundResult = "ignored";
      for (const targetEventId of change.targetEventIds) {
        const messageLink = await prisma.buzzMessageLink.findUnique({
          where: { eventId: targetEventId },
          select: {
            messageId: true,
            deleted: true,
            message: { select: { roomId: true } },
          },
        });
        if (messageLink) {
          if (messageLink.deleted) continue;
          await prisma.buzzMessageLink.update({
            where: { messageId: messageLink.messageId },
            data: { deleted: true },
          });
          await sendAs(core, author, {
            method: "DELETE",
            path: `/v1/chats/rooms/${messageLink.message.roomId}/messages/${messageLink.messageId}`,
          });
          result = "deleted";
          continue;
        }
        const reactionLink = await prisma.buzzReactionLink.findUnique({
          where: { eventId: targetEventId },
        });
        if (!reactionLink || reactionLink.identityId !== author.id) continue;
        const message = await prisma.chatRoomMessage.findUnique({
          where: { id: reactionLink.messageId },
          select: { roomId: true },
        });
        await prisma.buzzReactionLink.delete({
          where: { id: reactionLink.id },
        });
        if (!message) continue;
        await sendAs(core, author, {
          method: "DELETE",
          path: `/v1/chats/rooms/${message.roomId}/messages/${reactionLink.messageId}/reactions/${encodeURIComponent(reactionLink.emoji)}`,
        });
        result = "unreacted";
      }
      return result;
    }
    case "reaction": {
      const link = await prisma.buzzMessageLink.findUnique({
        where: { eventId: change.targetEventId },
        select: { messageId: true, message: { select: { roomId: true } } },
      });
      if (!link) return "ignored";
      try {
        await prisma.buzzReactionLink.create({
          data: {
            messageId: link.messageId,
            identityId: author.id,
            emoji: change.emoji,
            eventId: event.id,
          },
        });
      } catch (error) {
        if (isPrismaUniqueViolation(error)) return "echo";
        throw error;
      }
      await sendAs(core, author, {
        method: "PUT",
        path: `/v1/chats/rooms/${link.message.roomId}/messages/${link.messageId}/reactions/${encodeURIComponent(change.emoji)}`,
      });
      return "reacted";
    }
  }
}

/** Every linked channel of every community, for the worker's subscriptions. */
export async function buzzSubscriptions() {
  const communities = await prisma.buzzCommunity.findMany({
    select: {
      id: true,
      relayUrl: true,
      channels: { select: { channelId: true } },
    },
  });
  return communities.map((community) => ({
    communityId: community.id,
    relayUrl: community.relayUrl,
    channelIds: community.channels.map((channel) => channel.channelId),
  }));
}

/** Rooms of Buzz organizations that have no channel yet. */
export async function unlinkedBuzzRooms(limit = 50) {
  return prisma.chatRoom.findMany({
    where: {
      archivedAt: null,
      buzzChannel: null,
      organization: { buzzCommunity: { isNot: null } },
    },
    select: { id: true },
    take: limit,
  });
}
