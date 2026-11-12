import { randomUUID } from "node:crypto";
import { type BuzzIdentity, Prisma as PrismaNull } from "@sokosumi/database";
import { chatMessageTextWithNames, readChatMentionKeys } from "@sokosumi/utils";
import { npubEncode } from "nostr-tools/nip19";
import type { Event } from "nostr-tools/pure";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";

import { getEnv } from "@/config/env";
import {
  forceRevokeCoworkerWorkspaceAccessByPair,
  notifyWorkspaceApproversOfPendingCoworkerAccess,
} from "@/helpers/coworker-workspace-access";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import {
  BUZZ_AGENT_URL_PREFIX,
  BUZZ_KIND,
  channelIdOf,
  channelMembersDraft,
  communityMemberDraft,
  contentHash,
  createChannelDraft,
  deletionDraft,
  type EventDraft,
  editDraft,
  isBuzzAgentBaseUrl,
  MAX_DIRECT_MESSAGE_PEOPLE,
  messageDraft,
  openDirectMessageDraft,
  openedDirectMessageChannelId,
  profileDraft,
  reactionDraft,
  readableContent,
  readInbound,
} from "@/lib/buzz/events";
import { attestedOwner, authTagOwner } from "@/lib/buzz/owner-attestation";
import {
  BuzzRelayRejectedError,
  nip98Header,
  publishSignedEvent,
  queryEvents,
  relayHttpOrigin,
  signEvent,
} from "@/lib/buzz/relay-client";
import { openSecret, sealSecret } from "@/lib/buzz/secret-box";
import {
  COWORKER_API_KEY_START_LENGTH,
  generateCoworkerApiKeyToken,
  hashApiKey,
} from "@/lib/coworker-api-key";
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

/** Every key that speaks for this identity on Buzz: Sokosumi's, then their own app's. */
export function keysOf(identity: {
  pubkey: string;
  appPubkey: string | null;
}): string[] {
  return identity.appPubkey
    ? [identity.pubkey, identity.appPubkey]
    : [identity.pubkey];
}

export function identitySecretKey(identity: BuzzIdentity): Uint8Array {
  if (!identity.encryptedSecretKey) {
    throw new Error(`No secret key for ${identity.pubkey.slice(0, 8)}`);
  }
  return Uint8Array.from(
    Buffer.from(
      openSecret(identity.encryptedSecretKey, requireConfig().encryptionSecret),
      "hex",
    ),
  );
}

/**
 * A draft carrying the person's own Buzz key's authorization of this key
 * (Buzz: Settings → Security → Authorize external identity), when they gave
 * one: their Buzz agents take only their owner's word, and take an event so
 * authorized as the owner's.
 */
export function vouched(identity: BuzzIdentity, draft: EventDraft): EventDraft {
  const tag = authTagOf(identity);
  return tag ? { ...draft, tags: [...draft.tags, tag] } : draft;
}

/** Their authorization of Sokosumi's key, while it is from their linked key. */
function authTagOf(
  identity: Pick<BuzzIdentity, "appAuthTag" | "appPubkey">,
): string[] | null {
  const tag = identity.appAuthTag;
  return Array.isArray(tag) &&
    identity.appPubkey !== null &&
    tag[1] === identity.appPubkey
    ? (tag as string[])
    : null;
}

/** Metadata of a personal agent's "I only answer my owner" message. */
export const PERSONAL_AGENT_REFUSAL = "buzz_personal_agent_refusal";
export const PERSONAL_AGENT_REFUSAL_NOTICE = "buzz_personal_agent_notice";

function isRefusal(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>)[PERSONAL_AGENT_REFUSAL] === true
  );
}

/**
 * The owner of a personal agent (a Buzz agent made a Coworker), or null for
 * any other Coworker.
 */
export async function personalAgentOwnerOf(coworkerId: string) {
  const identity = await prisma.buzzIdentity.findUnique({
    where: { coworkerId },
    select: {
      ownerIdentity: {
        select: { userId: true, user: { select: { name: true } } },
      },
    },
  });
  const owner = identity?.ownerIdentity;
  return owner?.userId
    ? { userId: owner.userId, name: owner.user?.name ?? "its owner" }
    : null;
}

/**
 * Says on Buzz, as Sokosumi, in the thread of the message that asked, that a
 * personal agent only answers its owner; the agent itself cannot be made to
 * say it, its key is in its owner's Buzz app.
 */
async function tellRefusalOnBuzz(
  message: {
    id: string;
    parentMessageId: string | null;
    content: string;
    metadata: unknown;
  },
  channelId: string,
  relayUrl: string,
): Promise<ReconcileResult> {
  const notice = (message.metadata as Record<string, unknown>)[
    PERSONAL_AGENT_REFUSAL_NOTICE
  ];
  const text = typeof notice === "string" ? notice : message.content;
  const root = message.parentMessageId
    ? await prisma.buzzMessageLink.findUnique({
        where: { messageId: message.parentMessageId },
      })
    : null;
  if (message.parentMessageId && !root) {
    throw new Error("Thread root is not on Buzz yet");
  }
  await ensureOperatorProfile(relayUrl);
  const config = requireConfig();
  const event = signEvent(
    messageDraft({
      channelId,
      content: text,
      threadRootEventId: root?.eventId ?? null,
      mentionPubkeys: [],
    }),
    config.operatorSecretKey,
  );
  await prisma.buzzMessageLink.create({
    data: {
      messageId: message.id,
      eventId: event.id,
      contentHash: contentHash(message.content),
      channelId,
      signerPubkey: config.operatorPubkey,
      pendingEvent: event as unknown as object,
    },
  });
  const sent = await deliver(relayUrl, event);
  await prisma.buzzMessageLink.update({
    where: { messageId: message.id },
    data: { pendingEvent: PrismaNull.DbNull, eventId: sent.id },
  });
  return "published";
}

/** A key Sokosumi cannot sign with: a person's own Buzz agent. */
function isExternal(identity: BuzzIdentity): boolean {
  return !identity.encryptedSecretKey;
}

/**
 * The communities a person belongs to on Buzz: their organizations', plus
 * communities reached only through a room (a guest in another organization's
 * external channel is admitted there too).
 */
async function communitiesOf(userId: string) {
  const memberships = await prisma.member.findMany({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          buzzCommunity: {
            select: { id: true, relayUrl: true, allowPersonalAgents: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  // Organizations on Buzz, plus communities reached only through a room: a
  // guest in another organization's external channel is admitted there too.
  const viaRooms = await prisma.buzzCommunity.findMany({
    where: {
      channels: { some: { room: { userMembers: { some: { userId } } } } },
    },
    select: {
      id: true,
      relayUrl: true,
      allowPersonalAgents: true,
      organization: { select: { id: true, name: true } },
    },
  });
  const byOrganization = new Map<
    string,
    {
      communityId: string;
      organizationId: string;
      organizationName: string;
      relayUrl: string;
      allowPersonalAgents: boolean;
    }
  >();
  for (const { organization } of memberships) {
    if (!organization.buzzCommunity) continue;
    byOrganization.set(organization.id, {
      communityId: organization.buzzCommunity.id,
      organizationId: organization.id,
      organizationName: organization.name,
      relayUrl: organization.buzzCommunity.relayUrl,
      allowPersonalAgents: organization.buzzCommunity.allowPersonalAgents,
    });
  }
  for (const community of viaRooms) {
    if (byOrganization.has(community.organization.id)) continue;
    byOrganization.set(community.organization.id, {
      communityId: community.id,
      allowPersonalAgents: community.allowPersonalAgents,
      organizationId: community.organization.id,
      organizationName: community.organization.name,
      relayUrl: community.relayUrl,
    });
  }
  return { memberships, communities: [...byOrganization.values()] };
}

/** What a person needs to sign in to their organizations from a Buzz client. */
export async function buzzConnectionFor(userId: string) {
  const config = buzzConfig();
  if (!config) return null;
  const { memberships, communities } = await communitiesOf(userId);
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
    return {
      identity: null,
      app: null,
      agents: [],
      lastActiveOnBuzzAt: null,
      communities: [],
      canEnable,
    };
  }
  let identity = await ensureIdentity({ userId });
  if (identity.pendingAppPubkey) {
    // Linking finishes here too, so the page shows it without waiting for the worker.
    await verifyBuzzAppLinks({ identityId: identity.id }).catch((error) =>
      console.error("Buzz app link check failed", error),
    );
    identity = await prisma.buzzIdentity.findUniqueOrThrow({
      where: { id: identity.id },
    });
  }
  const appKey = identity.appPubkey ?? identity.pendingAppPubkey;
  const managed = new Set(
    memberships
      .filter(({ role }) => role === "owner" || role === "admin")
      .map(({ organization }) => organization.id),
  );
  const agents = await agentsOf(identity.id);
  return {
    identity: { pubkey: identity.pubkey, npub: npubEncode(identity.pubkey) },
    app: appKey
      ? {
          npub: npubEncode(appKey),
          status: identity.appPubkey
            ? ("linked" as const)
            : ("pending" as const),
          authorized: authTagOf(identity) !== null,
        }
      : null,
    agents,
    lastActiveOnBuzzAt: identity.lastActiveOnBuzzAt,
    communities: communities.map((community) => ({
      organizationId: community.organizationId,
      organizationName: community.organizationName,
      relayUrl: community.relayUrl,
      allowPersonalAgents: community.allowPersonalAgents,
      canManage: managed.has(community.organizationId),
    })),
    canEnable,
  };
}

// ---------------------------------------------------------------- app keys

export class BuzzAppLinkError extends Error {}

/** A single-use invite to one community, issued by the relay owner. */
async function mintInvite(relayUrl: string) {
  const url = `${relayHttpOrigin(relayUrl)}/api/invites`;
  const body = JSON.stringify({ max_uses: 1, ttl_secs: 24 * 60 * 60 });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: nip98Header({
        secretKey: requireConfig().operatorSecretKey,
        url,
        method: "POST",
        body,
      }),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Buzz relay refused an invite: ${response.status}`);
  }
  const { code } = (await response.json()) as { code: string };
  return code;
}

/**
 * Starts linking the person's own Buzz app key. It is linked once that key
 * joins one of their communities with an invite issued here
 * ({@link verifyBuzzAppLinks}): joining is signed by the key, so whoever
 * joins holds it.
 */
async function inviteAppKey(userId: string, pubkey: string) {
  const { communities } = await communitiesOf(userId);
  if (communities.length === 0) {
    throw new BuzzAppLinkError("None of your organizations is on Buzz yet.");
  }
  const identity = await ensureIdentity({ userId });
  const taken = await prisma.buzzIdentity.findFirst({
    where: {
      id: { not: identity.id },
      OR: [{ pubkey }, { appPubkey: pubkey }],
    },
  });
  if (taken) {
    throw new BuzzAppLinkError("That Buzz key belongs to another account.");
  }
  // One invite per community; organizations can share one in local setups.
  const byRelay = new Map(communities.map((c) => [c.relayUrl, c]));
  const invites = [];
  for (const community of byRelay.values()) {
    const code = await mintInvite(community.relayUrl);
    invites.push({
      organizationName: community.organizationName,
      relayUrl: community.relayUrl,
      joinUrl: `buzz://join?relay=${encodeURIComponent(community.relayUrl)}&code=${encodeURIComponent(code)}`,
      inviteUrl: `${relayHttpOrigin(community.relayUrl)}/invite/${code}`,
    });
  }
  // Recorded once the invites exist, so a failed request leaves nothing
  // pending; a key can only join after its person has seen them.
  if (identity.appPubkey !== pubkey) {
    await prisma.buzzIdentity.update({
      where: { id: identity.id },
      data: { pendingAppPubkey: pubkey, pendingAppSince: new Date() },
    });
  }
  return invites;
}

/** Rooms the person is in that are on Buzz get their members pushed again. */
async function resyncRoomsOf(userId: string) {
  // A DM keeps its hash: syncing it compares its keys and retires it if
  // they changed.
  const channels = await prisma.buzzChannel.findMany({
    where: {
      room: { userMembers: { some: { userId } } },
    },
    select: { id: true, roomId: true },
  });
  await prisma.buzzChannel.updateMany({
    where: {
      id: { in: channels.map((c) => c.id) },
      NOT: { membersHash: { startsWith: DIRECT } },
    },
    data: { membersHash: null },
  });
  if (channels.length > 0) {
    await prisma.buzzOutbox.createMany({
      data: channels.map((c) => ({ roomId: c.roomId, messageId: null })),
    });
  }
}

/**
 * Links each pending app key that has joined one of its person's communities
 * since the link was asked for. Two people asking for the same key link
 * neither: the relay does not say which invite a key used.
 */
export async function verifyBuzzAppLinks(scope: { identityId?: string } = {}) {
  const config = requireConfig();
  const pending = await prisma.buzzIdentity.findMany({
    where: {
      pendingAppPubkey: { not: null },
      userId: { not: null },
      ...(scope.identityId ? { id: scope.identityId } : {}),
    },
  });
  const linked: string[] = [];
  for (const identity of pending) {
    const pubkey = identity.pendingAppPubkey as string;
    const since = Math.floor(
      (identity.pendingAppSince ?? new Date(0)).getTime() / 1000,
    );
    const claimants = await prisma.buzzIdentity.count({
      where: {
        OR: [{ pubkey }, { appPubkey: pubkey }, { pendingAppPubkey: pubkey }],
      },
    });
    if (claimants > 1) continue;
    const { communities } = await communitiesOf(identity.userId as string);
    let joined = false;
    for (const community of communities) {
      const added = await queryEvents({
        relayUrl: community.relayUrl,
        secretKey: config.operatorSecretKey,
        filters: [{ kinds: [BUZZ_KIND.memberAdded], "#p": [pubkey], since }],
      });
      if (added.some((event) => event.created_at >= since)) {
        joined = true;
        break;
      }
    }
    if (!joined) continue;
    await prisma.$transaction([
      prisma.buzzIdentity.update({
        where: { id: identity.id },
        data: {
          appPubkey: pubkey,
          pendingAppPubkey: null,
          pendingAppSince: null,
          profileHash: null,
        },
      }),
      // Re-admit both keys to every community the person is in.
      prisma.buzzCommunityMember.deleteMany({
        where: { identityId: identity.id },
      }),
    ]);
    await resyncRoomsOf(identity.userId as string);
    await syncBuzzAgents({ identityId: identity.id }).catch((error) =>
      console.error("Buzz agent sync failed", error),
    );
    linked.push(identity.id);
  }
  return linked;
}

// ---------------------------------------------------------------- agents

const AGENT_VENDOR_SLUG = "buzz-agents";
const HEX_64 = /^[0-9a-f]{64}$/;

type FoundAgent = { name: string; picture: string | null; relayUrl: string };

/**
 * The agents these owner keys have on one relay, per the owners' kind 30177
 * records, kept only when the agent's newest profile carries an owner
 * attestation from that same key: a record alone proves nothing.
 */
async function ownedAgents(relayUrl: string, ownerKeys: string[]) {
  const secretKey = requireConfig().operatorSecretKey;
  const found = new Map<string, FoundAgent & { ownerKey: string }>();
  const records = await queryEvents({
    relayUrl,
    secretKey,
    filters: [{ kinds: [BUZZ_KIND.agentRecord], authors: ownerKeys }],
  });
  const recorded = new Map<string, { ownerKey: string; name?: string }>();
  for (const record of records) {
    const pubkey = record.tags.find((tag) => tag[0] === "d")?.[1];
    if (!pubkey || !HEX_64.test(pubkey)) continue;
    recorded.set(pubkey, {
      ownerKey: record.pubkey,
      name: readJson(record.content).name,
    });
  }
  if (recorded.size === 0) return found;
  const profiles = await queryEvents({
    relayUrl,
    secretKey,
    filters: [{ kinds: [BUZZ_KIND.profile], authors: [...recorded.keys()] }],
  });
  const newest = new Map<string, Event>();
  for (const profile of profiles) {
    const seen = newest.get(profile.pubkey);
    if (!seen || profile.created_at > seen.created_at) {
      newest.set(profile.pubkey, profile);
    }
  }
  for (const [pubkey, profile] of newest) {
    const record = recorded.get(pubkey);
    if (!record || !verifyEvent(profile)) continue;
    if (attestedOwner(profile) !== record.ownerKey) continue;
    const content = readJson(profile.content);
    found.set(pubkey, {
      name: content.name ?? record.name ?? "Buzz agent",
      picture: content.picture ?? null,
      relayUrl,
      ownerKey: record.ownerKey,
    });
  }
  return found;
}

function readJson(content: string): { name?: string; picture?: string } {
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object") return {};
    const { name, picture } = value as Record<string, unknown>;
    return {
      name: typeof name === "string" && name.trim() ? name.trim() : undefined,
      picture:
        typeof picture === "string" && picture.startsWith("https://")
          ? picture
          : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Where a person's agent may be used: their own workspace and each of their
 * organizations on Buzz. It is granted where the organization lets members
 * bring personal agents (or the person administers it); elsewhere requested.
 */
async function agentAccessOf(
  userId: string,
  memberships: { role: string; organization: { id: string } }[],
  communities: { organizationId: string; allowPersonalAgents: boolean }[],
) {
  const admin = new Set(
    memberships
      .filter(({ role }) => role === "owner" || role === "admin")
      .map(({ organization }) => organization.id),
  );
  const open = new Set(
    communities
      .filter((community) => community.allowPersonalAgents)
      .map((community) => community.organizationId),
  );
  const workspaces = await prisma.workspace.findMany({
    where: {
      OR: [
        { userId },
        { organizationId: { in: communities.map((c) => c.organizationId) } },
      ],
    },
    select: { id: true, userId: true, organizationId: true },
  });
  return workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    granted:
      workspace.userId === userId ||
      (workspace.organizationId !== null &&
        (open.has(workspace.organizationId) ||
          admin.has(workspace.organizationId))),
  }));
}

/**
 * Makes each Buzz agent a person owns a private Coworker: usable in their
 * workspaces, managed by them, posting through Core with its own key. An
 * agent that is gone is archived, and one that is back is restored.
 */
export async function syncBuzzAgents(scope: { identityId?: string } = {}) {
  // An agent's owner is the key the person's Buzz app signs in with: the one
  // Sokosumi keeps for them, or their own app key when they linked one.
  const owners = await prisma.buzzIdentity.findMany({
    where: {
      userId: { not: null },
      ...(scope.identityId ? { id: scope.identityId } : {}),
    },
    include: { user: { select: { name: true } } },
  });
  const people = await Promise.all(
    owners.map(async (owner) => ({
      owner,
      ...(await communitiesOf(owner.userId as string)),
    })),
  );
  // One read per relay for everyone on it.
  const keysByRelay = new Map<string, Set<string>>();
  for (const { owner, communities } of people) {
    for (const { relayUrl } of communities) {
      const keys = keysByRelay.get(relayUrl) ?? new Set<string>();
      for (const key of keysOf(owner)) keys.add(key);
      keysByRelay.set(relayUrl, keys);
    }
  }
  const agentsByOwnerKey = new Map<string, Map<string, FoundAgent>>();
  for (const [relayUrl, keys] of keysByRelay) {
    for (const [pubkey, agent] of await ownedAgents(relayUrl, [...keys])) {
      const agents = agentsByOwnerKey.get(agent.ownerKey) ?? new Map();
      agents.set(pubkey, agent);
      agentsByOwnerKey.set(agent.ownerKey, agents);
    }
  }
  const changed: string[] = [];
  for (const { owner, memberships, communities } of people) {
    const userId = owner.userId as string;
    const found = new Map<string, FoundAgent>(
      keysOf(owner).flatMap((key) => [
        ...(agentsByOwnerKey.get(key)?.entries() ?? []),
      ]),
    );
    const access = await agentAccessOf(userId, memberships, communities);
    const vendor = await prisma.vendor.upsert({
      where: { slug: AGENT_VENDOR_SLUG },
      create: { slug: AGENT_VENDOR_SLUG, name: "Buzz agents", listed: false },
      update: {},
    });
    for (const [pubkey, agent] of found) {
      const existing = await prisma.buzzIdentity.findUnique({
        where: { pubkey },
        include: { coworker: true },
      });
      // A key Sokosumi already knows as someone else stays theirs.
      if (existing && existing.ownerIdentityId !== owner.id) continue;
      const details = {
        name: `${agent.name} (personal agent)`,
        image: agent.picture,
        caption: `Personal agent via Buzz · ${owner.user?.name ?? "someone"}`,
        baseURL: `${BUZZ_AGENT_URL_PREFIX}${new URL(agent.relayUrl).host}`,
      };
      let coworkerId = existing?.coworkerId ?? null;
      if (!coworkerId) {
        const coworker = await prisma.coworker.create({
          data: {
            ...details,
            slug: `buzz-${pubkey.slice(0, 16)}`,
            description:
              "A personal agent: it runs in its owner's Buzz app, only its owner can add it to a room, and it answers there.",
            capabilities: ["chat"],
            isWhitelisted: false,
            vendorId: vendor.id,
            assignments: { create: { userId } },
            buzzIdentity: {
              create: { pubkey, ownerIdentityId: owner.id },
            },
          },
        });
        coworkerId = coworker.id;
        changed.push(coworkerId);
      } else if (
        existing?.coworker &&
        (existing.coworker.archivedAt ||
          existing.coworker.name !== details.name ||
          existing.coworker.image !== details.image)
      ) {
        await prisma.coworker.update({
          where: { id: coworkerId },
          data: { ...details, archivedAt: null },
        });
        changed.push(coworkerId);
      }
      // Granted where the owner may grant (their own workspace, organizations
      // they own or administer); elsewhere requested, and that workspace's
      // owners and admins are notified to approve it.
      for (const { workspaceId, granted } of access) {
        const where = {
          coworkerId_workspaceId: {
            coworkerId: coworkerId as string,
            workspaceId,
          },
        };
        const existingAccess = await prisma.coworkerWorkspaceAccess.findUnique({
          where,
        });
        if (existingAccess) {
          // The switch's own grants and revocations have no resolver; one a
          // person made (say the owner revoking it) stays as they left it.
          const bySwitch = existingAccess.resolvedById === null;
          const reopen =
            existingAccess.status === "PENDING" ||
            (existingAccess.status === "REVOKED" && bySwitch);
          if (granted && reopen) {
            await prisma.coworkerWorkspaceAccess.update({
              where,
              data: {
                status: "GRANTED",
                resolvedById: null,
                resolvedAt: new Date(),
              },
            });
          } else if (
            !granted &&
            existingAccess.status === "GRANTED" &&
            bySwitch
          ) {
            // Granted by the switch that is now off: the agent leaves.
            await prisma.$transaction(async (tx) => {
              await forceRevokeCoworkerWorkspaceAccessByPair(
                {
                  coworkerId: coworkerId as string,
                  workspaceId,
                  resolvedById: userId,
                },
                tx,
              );
              await tx.coworkerWorkspaceAccess.update({
                where,
                data: { resolvedById: null },
              });
            });
            await resyncRoomsWithCoworkers([coworkerId as string]);
            changed.push(`revoked:${coworkerId}`);
          }
          continue;
        }
        const created = await prisma.coworkerWorkspaceAccess.create({
          data: {
            coworkerId: coworkerId as string,
            workspaceId,
            requestedByUserId: userId,
            ...(granted
              ? {
                  status: "GRANTED" as const,
                  resolvedById: null,
                  resolvedAt: new Date(),
                }
              : { status: "PENDING" as const }),
          },
        });
        if (!granted) {
          await notifyWorkspaceApproversOfPendingCoworkerAccess({
            coworkerId: created.coworkerId,
            workspaceId,
            accessId: created.id,
          });
        }
      }
    }
    // An agent no longer found is archived and leaves its rooms on Buzz.
    const gone = await prisma.coworker.findMany({
      where: {
        archivedAt: null,
        buzzIdentity: {
          ownerIdentityId: owner.id,
          pubkey: { notIn: [...found.keys()] },
        },
      },
      select: { id: true },
    });
    if (gone.length > 0) {
      await prisma.coworker.updateMany({
        where: { id: { in: gone.map((agent) => agent.id) } },
        data: { archivedAt: new Date() },
      });
      await resyncRoomsWithCoworkers(gone.map((agent) => agent.id));
      changed.push(`archived:${gone.length}`);
    }
  }
  return changed;
}

/**
 * A personal agent is in a room only with its owner: one whose owner left
 * (or was removed) leaves too.
 */
export async function removeAgentsWithoutOwner() {
  const memberships = await prisma.chatRoomCoworkerMember.findMany({
    where: { coworker: { buzzIdentity: { ownerIdentityId: { not: null } } } },
    select: {
      roomId: true,
      coworkerId: true,
      room: { select: { userMembers: { select: { userId: true } } } },
      coworker: {
        select: {
          buzzIdentity: {
            select: { ownerIdentity: { select: { userId: true } } },
          },
        },
      },
    },
  });
  const orphaned = memberships.filter(
    (membership) =>
      !membership.room.userMembers.some(
        (member) =>
          member.userId ===
          membership.coworker.buzzIdentity?.ownerIdentity?.userId,
      ),
  );
  for (const { roomId, coworkerId } of orphaned) {
    await prisma.chatRoomCoworkerMember.deleteMany({
      where: { roomId, coworkerId },
    });
  }
  await resyncRoomsWithCoworkers([
    ...new Set(orphaned.map((membership) => membership.coworkerId)),
  ]);
  return orphaned.length;
}

/** The person's Buzz agents Sokosumi knows, for Connections. */
async function agentsOf(identityId: string) {
  const agents = await prisma.buzzIdentity.findMany({
    where: { ownerIdentityId: identityId, coworker: { archivedAt: null } },
    select: { pubkey: true, coworker: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return agents.map((agent) => ({
    name: agent.coworker?.name ?? "Buzz agent",
    npub: npubEncode(agent.pubkey),
  }));
}

/**
 * Links the person's own Buzz identity from the proof their Buzz app signed
 * for Sokosumi's key (Settings → Buzz → Security → Authorize external
 * identity). The proof names their Buzz key and shows they hold it, and it is
 * sent on what Sokosumi signs for them, so their Buzz agents take it as
 * theirs. A key not linked yet gets invites and is linked once it joins.
 */
export async function linkBuzzApp(userId: string, input: string) {
  const identity = await ensureIdentity({ userId });
  let tag: unknown;
  try {
    tag = JSON.parse(input.trim());
  } catch {
    throw new BuzzAppLinkError(
      'Paste the whole proof Buzz shows, ["auth", …].',
    );
  }
  const owner =
    Array.isArray(tag) &&
    tag.length === 4 &&
    tag.every((part) => typeof part === "string") &&
    tag[2] === ""
      ? authTagOwner(identity.pubkey, tag as string[])
      : null;
  if (!owner) {
    throw new BuzzAppLinkError(
      "This proof is not for your Sokosumi key. Authorize the key shown here, then copy the new proof.",
    );
  }
  if (identity.appPubkey && identity.appPubkey !== owner) {
    throw new BuzzAppLinkError(
      "This proof is from another Buzz identity than the one linked. Unlink it first.",
    );
  }
  const invites =
    identity.appPubkey === owner ? [] : await inviteAppKey(userId, owner);
  await prisma.buzzIdentity.update({
    where: { id: identity.id },
    data: { appAuthTag: tag as string[] },
  });
  return invites;
}

/** Forgets the person's own app key; their channels drop it within a minute. */
export async function unlinkBuzzApp(userId: string) {
  const identity = await prisma.buzzIdentity.findUnique({ where: { userId } });
  if (!identity) return;
  await prisma.buzzIdentity.update({
    where: { id: identity.id },
    data: {
      appPubkey: null,
      appAuthTag: PrismaNull.DbNull,
      pendingAppPubkey: null,
      pendingAppSince: null,
      profileHash: null,
    },
  });
  // Its agents were theirs through that key.
  const agents = await prisma.coworker.findMany({
    where: { archivedAt: null, buzzIdentity: { ownerIdentityId: identity.id } },
    select: { id: true },
  });
  await prisma.coworker.updateMany({
    where: { id: { in: agents.map((agent) => agent.id) } },
    data: { archivedAt: new Date() },
  });
  await resyncRoomsOf(userId);
  await resyncRoomsWithCoworkers(agents.map((agent) => agent.id));
}

/** Rooms an agent is in get their members pushed again. */
async function resyncRoomsWithCoworkers(coworkerIds: string[]) {
  if (coworkerIds.length === 0) return;
  const channels = await prisma.buzzChannel.findMany({
    where: {
      room: { coworkerMembers: { some: { coworkerId: { in: coworkerIds } } } },
    },
    select: { id: true, roomId: true },
  });
  await prisma.buzzChannel.updateMany({
    where: {
      id: { in: channels.map((c) => c.id) },
      NOT: { membersHash: { startsWith: DIRECT } },
    },
    data: { membersHash: null },
  });
  if (channels.length > 0) {
    await prisma.buzzOutbox.createMany({
      data: channels.map((c) => ({ roomId: c.roomId, messageId: null })),
    });
  }
}

// ---------------------------------------------------------------- enabling

export function communityUrlFor(slug: string): string {
  return requireConfig().communityUrlTemplate.replaceAll("{slug}", slug);
}

/**
 * Whether members may bring their personal agents into this organization's
 * rooms without approval. The worker applies it within a minute: agents
 * granted by it are granted or revoked (and leave their rooms) to match.
 */
export async function setAllowPersonalAgents(
  organizationId: string,
  allowPersonalAgents: boolean,
) {
  return prisma.buzzCommunity.update({
    where: { organizationId },
    data: { allowPersonalAgents },
  });
}

export async function enableBuzzForOrganization(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { slug: true },
  });
  return prisma.buzzCommunity.upsert({
    where: { organizationId },
    create: {
      organizationId,
      relayUrl: communityUrlFor(organization.slug),
      // Nothing before this is read; everything after it is, even after an
      // outage that starts right away.
      inboundCursor: Math.floor(Date.now() / 1000),
    },
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
    // An archived coworker (a person's Buzz agent they removed) leaves Buzz.
    where: { coworker: { archivedAt: null } },
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
  for (const pubkey of keysOf(identity)) {
    try {
      await publish(
        relayUrl,
        requireConfig().operatorSecretKey,
        communityMemberDraft(pubkey),
      );
    } catch (error) {
      if (!isAlreadyDone(error)) throw error;
    }
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
  // A Buzz agent's profile is its owner's app's to publish.
  if (isExternal(identity)) return;
  const draft = profileDraft(profile);
  const hash = contentHash(`${relayUrl}\n${draft.content}`);
  if (identity.profileHash === hash) return;
  await publish(relayUrl, identitySecretKey(identity), draft);
  await prisma.buzzIdentity.update({
    where: { id: identity.id },
    data: { profileHash: hash },
  });
}

const DIRECT = "direct";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDirect(channel: { membersHash: string | null }): boolean {
  return Boolean(channel.membersHash?.startsWith(DIRECT));
}

/**
 * Lets a DM go whose people changed (a key unlinked, a member removed): a
 * Buzz DM's people are fixed, so the next message opens a new one. Messages
 * already in it stay linked there and get nothing more; what was still to be
 * sent there is dropped.
 */
async function retireDirectMessage(
  roomId: string,
  channel: { id: string; channelId: string },
) {
  const linked = await prisma.buzzMessageLink.findMany({
    where: { message: { roomId } },
    select: { messageId: true },
  });
  await prisma.$transaction([
    prisma.buzzMessageLink.updateMany({
      where: { message: { roomId }, channelId: null },
      data: { channelId: channel.channelId },
    }),
    prisma.buzzMessageLink.updateMany({
      where: { channelId: channel.channelId },
      data: { pendingEvent: PrismaNull.DbNull },
    }),
    prisma.buzzReactionLink.updateMany({
      where: { messageId: { in: linked.map((link) => link.messageId) } },
      data: { pendingEvent: PrismaNull.DbNull },
    }),
    prisma.buzzChannel.delete({ where: { id: channel.id } }),
  ]);
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
      // Their own app key carries their Buzz profile; this one is Sokosumi's.
      name: identity.appPubkey
        ? `${member.user.name} (via Sokosumi)`
        : member.user.name,
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
  const directKeys = members.flatMap((member) => keysOf(member.identity));
  const asDirectMessage =
    room.kind === "direct" &&
    members.length >= 2 &&
    directKeys.length <= MAX_DIRECT_MESSAGE_PEOPLE;

  const directHash = `${DIRECT}:${contentHash([...directKeys].sort().join(","))}`;
  let channel = room.buzzChannel;
  if (
    channel &&
    isDirect(channel) &&
    (!asDirectMessage || channel.membersHash !== directHash)
  ) {
    await retireDirectMessage(room.id, channel);
    channel = null;
  }
  if (!channel && asDirectMessage) {
    const [opener] = members;
    const event = signEvent(
      vouched(
        opener.identity,
        openDirectMessageDraft(
          directKeys.filter((pubkey) => pubkey !== opener.identity.pubkey),
        ),
      ),
      identitySecretKey(opener.identity),
    );
    const { message } = await publishSignedEvent({
      relayUrl,
      event,
      secretKey: identitySecretKey(opener.identity),
    });
    const channelId = openedDirectMessageChannelId(message);
    if (!channelId) throw new Error(`Buzz did not open the DM: ${message}`);
    // A Buzz DM is its people: a second Direct between the same ones (say a
    // personal and an organization one) gets a private channel instead.
    const taken = await prisma.buzzChannel.findUnique({
      where: { channelId },
    });
    if (taken?.roomId === room.id) {
      channel = taken;
    } else if (!taken) {
      channel = await prisma.buzzChannel.create({
        data: {
          roomId: room.id,
          communityId: community.id,
          channelId,
          membersHash: directHash,
        },
      });
    }
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
  if (isDirect(channel)) return { channel, relayUrl };

  const wanted = new Map(
    members.flatMap((member) =>
      keysOf(member.identity).map((pubkey) => [pubkey, member.role] as const),
    ),
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
  metadata: true,
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
  | "delivered"
  | "published"
  | "edited"
  | "deleted"
  | "linked"
  | "unchanged"
  | "skipped";

type PendingEvent = Event;

function asPending(value: unknown): PendingEvent | null {
  return value && typeof value === "object" ? (value as PendingEvent) : null;
}

/**
 * Sends a stored, signed event. It is kept on its link until the relay has
 * it, so a crash or outage between "decided" and "delivered" is resent, not
 * lost. Sending the same event twice is harmless: same id, the relay keeps one.
 */
async function deliver(
  relayUrl: string,
  event: PendingEvent,
  /** Records a re-signed event's new id before it is sent, so its echo is known. */
  recordResigned: (fresh: PendingEvent) => Promise<unknown> = async () => {},
): Promise<PendingEvent> {
  const config = requireConfig();
  // Sokosumi's own notices are signed by the relay owner.
  const signer =
    event.pubkey === config.operatorPubkey
      ? null
      : await prisma.buzzIdentity.findUnique({
          where: { pubkey: event.pubkey },
        });
  if (event.pubkey !== config.operatorPubkey && !signer) {
    throw new Error(`No key for ${event.pubkey.slice(0, 8)}`);
  }
  const secretKey = signer
    ? identitySecretKey(signer)
    : config.operatorSecretKey;
  try {
    await publishSignedEvent({ relayUrl, event, secretKey });
    return event;
  } catch (error) {
    if (isAlreadyDone(error)) return event;
    // Held through a long outage, it is now too old for the relay: sign it
    // again with the current time (a new id; the caller records it).
    if (
      error instanceof BuzzRelayRejectedError &&
      /timestamp/i.test(error.reason)
    ) {
      const fresh = signEvent(
        { kind: event.kind, tags: event.tags, content: event.content },
        secretKey,
      );
      await recordResigned(fresh);
      await publishSignedEvent({ relayUrl, event: fresh, secretKey });
      return fresh;
    }
    throw error;
  }
}

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
  let link = message.buzzLink;
  // A Buzz agent's messages start on Buzz and are linked as they come in;
  // Sokosumi cannot sign for it, but people's reactions to them are theirs.
  // Linked in a DM since retired: it stays as it was there.
  if (link?.channelId && link.channelId !== channel.channelId) {
    return "skipped";
  }
  if (isExternal(authorIdentity)) {
    if (!link && !message.deletedAt && isRefusal(message.metadata)) {
      return tellRefusalOnBuzz(message, channel.channelId, relayUrl);
    }
    // A refusal Sokosumi decided but could not deliver yet.
    const unsent = asPending(link?.pendingEvent);
    if (link && unsent) {
      const sent = await deliver(relayUrl, unsent);
      link = await prisma.buzzMessageLink.update({
        where: { messageId: message.id },
        data: { pendingEvent: PrismaNull.DbNull, eventId: sent.id },
      });
    }
    if (!link || message.deletedAt) return "skipped";
    await reconcileReactions({
      messageId: message.id,
      eventId: link.eventId,
      authorPubkey: authorIdentity.pubkey,
      channelId: channel.channelId,
      relayUrl,
      reactions: message.reactions,
    });
    return "unchanged";
  }
  const authorKey = identitySecretKey(authorIdentity);
  const hash = contentHash(message.content);
  let result: ReconcileResult = "unchanged";

  // Finish what an earlier attempt decided but could not deliver.
  const unfinished = asPending(link?.pendingEvent);
  if (link && unfinished) {
    const messageLinkId = message.id;
    const sent = await deliver(relayUrl, unfinished, (fresh) =>
      prisma.buzzMessageLink.update({
        where: { messageId: messageLinkId },
        data: {
          pendingEvent: fresh as unknown as object,
          ...(fresh.kind === BUZZ_KIND.message ? { eventId: fresh.id } : {}),
        },
      }),
    );
    link = await prisma.buzzMessageLink.update({
      where: { messageId: message.id },
      data: {
        pendingEvent: PrismaNull.DbNull,
        ...(sent.kind === BUZZ_KIND.message ? { eventId: sent.id } : {}),
      },
    });
    result = "delivered";
  }

  /** Records the change with its event, then delivers it. */
  const decideAndDeliver = async (
    event: PendingEvent,
    data: {
      contentHash?: string;
      lastEditAt?: number;
      lastEditEventId?: string;
      deleted?: boolean;
    },
  ) => {
    link = await prisma.buzzMessageLink.update({
      where: { messageId: message.id },
      data: { ...data, pendingEvent: event as unknown as object },
    });
    await deliver(relayUrl, event, (fresh) =>
      prisma.buzzMessageLink.update({
        where: { messageId: message.id },
        data: { pendingEvent: fresh as unknown as object },
      }),
    );
    link = await prisma.buzzMessageLink.update({
      where: { messageId: message.id },
      data: { pendingEvent: PrismaNull.DbNull },
    });
  };

  if (!link) {
    if (message.deletedAt) return "skipped";
    if (message.clientMessageId?.startsWith("buzz:")) {
      // Posted from Buzz: the event already exists. Inbound usually linked
      // it already; this covers a worker that stopped in between. Who
      // signed it decides whether Sokosumi may change it there.
      const eventId = message.clientMessageId.slice("buzz:".length);
      const [original] = await queryEvents({
        relayUrl,
        secretKey: authorKey,
        filters: [{ ids: [eventId] }],
      });
      if (!original)
        throw new Error(`Buzz event ${eventId.slice(0, 8)} not found`);
      link = await prisma.buzzMessageLink.upsert({
        where: { messageId: message.id },
        create: {
          messageId: message.id,
          eventId,
          contentHash: hash,
          channelId: channel.channelId,
          signerPubkey:
            original.pubkey === authorIdentity.pubkey ? null : original.pubkey,
        },
        update: {},
      });
      result = "linked";
    } else {
      // A reply still streaming has no text yet; its next update brings it.
      if (!message.content.trim()) return "skipped";
      let threadRootEventId: string | null = null;
      if (message.parentMessageId) {
        if (depth === 0) {
          await reconcileMessage(message.parentMessageId, depth + 1);
        }
        const parentLink = await prisma.buzzMessageLink.findUnique({
          where: { messageId: message.parentMessageId },
        });
        // Never post a reply as a new thread; the outbox retries it.
        if (!parentLink) throw new Error("Thread root is not on Buzz yet");
        // Unless the thread started in a DM since retired: its start is not
        // in this conversation, so the reply stands on its own here.
        threadRootEventId =
          parentLink.channelId && parentLink.channelId !== channel.channelId
            ? null
            : parentLink.eventId;
      }
      const event = signEvent(
        vouched(
          authorIdentity,
          messageDraft({
            channelId: channel.channelId,
            content: await buzzContentOf(message.content),
            threadRootEventId,
            mentionPubkeys: await mentionPubkeysOf(message),
          }),
        ),
        authorKey,
      );
      link = await prisma.buzzMessageLink.create({
        data: {
          messageId: message.id,
          eventId: event.id,
          contentHash: hash,
          channelId: channel.channelId,
          pendingEvent: event as unknown as object,
        },
      });
      const sent = await deliver(relayUrl, event, (fresh) =>
        prisma.buzzMessageLink.update({
          where: { messageId: message.id },
          data: { eventId: fresh.id, pendingEvent: fresh as unknown as object },
        }),
      );
      link = await prisma.buzzMessageLink.update({
        where: { messageId: message.id },
        data: { pendingEvent: PrismaNull.DbNull, eventId: sent.id },
      });
      result = "published";
    }
  } else if (
    link.signerPubkey &&
    (message.deletedAt ? !link.deleted : link.contentHash !== hash)
  ) {
    // Written with the person's own app key: only they can change it on Buzz.
    link = await prisma.buzzMessageLink.update({
      where: { messageId: message.id },
      data: { contentHash: hash, deleted: Boolean(message.deletedAt) },
    });
    if (message.deletedAt) return "deleted";
    result = "edited";
  } else if (message.deletedAt && !link.deleted) {
    await decideAndDeliver(
      signEvent(
        vouched(
          authorIdentity,
          deletionDraft({
            channelId: channel.channelId,
            eventId: link.eventId,
          }),
        ),
        authorKey,
      ),
      { deleted: true },
    );
    return "deleted";
  } else if (!message.deletedAt && link.contentHash !== hash) {
    const event = signEvent(
      vouched(
        authorIdentity,
        editDraft({
          channelId: channel.channelId,
          eventId: link.eventId,
          content: await buzzContentOf(message.content),
        }),
      ),
      authorKey,
    );
    await decideAndDeliver(event, {
      contentHash: hash,
      lastEditAt: event.created_at,
      lastEditEventId: event.id,
    });
    result = "edited";
  }

  if (!message.deletedAt) {
    await reconcileReactions({
      messageId: message.id,
      eventId: link.eventId,
      authorPubkey: link.signerPubkey ?? authorIdentity.pubkey,
      channelId: channel.channelId,
      relayUrl,
      reactions: message.reactions,
    });
  }
  return result;
}

/**
 * A message as Buzz shows it: Sokosumi's mention tokens (`@<id>:<slug>`)
 * become Buzz mentions (`nostr:npub…`, the person's own app key when linked),
 * or the name for someone with no Buzz key.
 */
export async function buzzContentOf(content: string): Promise<string> {
  const keys = readChatMentionKeys(content).filter((key) => key !== "all");
  if (keys.length === 0) return content;
  // People may have 32-character auth ids; Soko Bot ids are uuids.
  const uuidKeys = keys.filter((key) => UUID.test(key));
  const identities = await prisma.buzzIdentity.findMany({
    where: {
      OR: [
        { userId: { in: keys } },
        { coworkerId: { in: keys } },
        { sokoBotId: { in: uuidKeys } },
      ],
    },
    select: {
      pubkey: true,
      appPubkey: true,
      userId: true,
      coworkerId: true,
      sokoBotId: true,
    },
  });
  let text = content;
  for (const identity of identities) {
    const key = identity.userId ?? identity.coworkerId ?? identity.sokoBotId;
    if (!key) continue;
    const token = new RegExp(
      `@${key.replace(/[^A-Za-z0-9-]/g, "")}(?::[\\p{L}\\p{N}_-]*)?(?![\\p{L}\\p{N}_-])`,
      "giu",
    );
    text = text.replace(
      token,
      `nostr:${npubEncode(identity.appPubkey ?? identity.pubkey)}`,
    );
  }
  // Whoever is left has no Buzz key: their name, which Buzz shows as text.
  const [users, coworkers, sokoBots] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: keys } },
      select: { id: true, name: true },
    }),
    prisma.coworker.findMany({
      where: { id: { in: keys } },
      select: { id: true, name: true },
    }),
    prisma.sokoBot.findMany({
      where: { id: { in: uuidKeys } },
      select: { id: true, name: true },
    }),
  ]);
  const names = new Map<string, string>(
    [...users, ...coworkers, ...sokoBots].map((owner) => [
      owner.id.includes("-") ? owner.id.toLowerCase() : owner.id,
      owner.name ?? "",
    ]),
  );
  return chatMessageTextWithNames(text, names);
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
    pubkeys.push(...keysOf(await ensureIdentity(owner)));
  }
  return pubkeys;
}

/**
 * A reaction link with a pending kind:5 is being taken back; one with a
 * pending kind:7 is being added. Either way the row stays until delivered.
 */
function isBeingRemoved(link: { pendingEvent: unknown }) {
  return asPending(link.pendingEvent)?.kind === BUZZ_KIND.deletion;
}

async function reconcileReactions(input: {
  messageId: string;
  eventId: string;
  authorPubkey: string;
  channelId: string;
  relayUrl: string;
  reactions: { userId: string; emoji: string }[];
}) {
  let links = await prisma.buzzReactionLink.findMany({
    where: { messageId: input.messageId },
    include: { identity: true },
  });

  // Finish what an earlier attempt decided but could not deliver.
  for (const link of links) {
    const pending = asPending(link.pendingEvent);
    if (!pending) continue;
    const sent = await deliver(input.relayUrl, pending, (fresh) =>
      prisma.buzzReactionLink.update({
        where: { id: link.id },
        data: {
          pendingEvent: fresh as unknown as object,
          ...(fresh.kind === BUZZ_KIND.reaction ? { eventId: fresh.id } : {}),
        },
      }),
    );
    if (pending.kind === BUZZ_KIND.deletion) {
      await prisma.buzzReactionLink.delete({ where: { id: link.id } });
    } else {
      await prisma.buzzReactionLink.update({
        where: { id: link.id },
        data: { pendingEvent: PrismaNull.DbNull, eventId: sent.id },
      });
    }
  }
  links = await prisma.buzzReactionLink.findMany({
    where: { messageId: input.messageId },
    include: { identity: true },
  });

  const key = (userId: string | null, emoji: string) => `${userId}\n${emoji}`;
  const linked = new Set(links.map((l) => key(l.identity.userId, l.emoji)));
  const wanted = new Set(input.reactions.map((r) => key(r.userId, r.emoji)));

  for (const reaction of input.reactions) {
    if (linked.has(key(reaction.userId, reaction.emoji))) continue;
    const identity = await ensureIdentity({ userId: reaction.userId });
    const event = signEvent(
      vouched(
        identity,
        reactionDraft({
          channelId: input.channelId,
          eventId: input.eventId,
          authorPubkey: input.authorPubkey,
          emoji: reaction.emoji,
        }),
      ),
      identitySecretKey(identity),
    );
    let linkId: string;
    try {
      linkId = (
        await prisma.buzzReactionLink.create({
          data: {
            messageId: input.messageId,
            identityId: identity.id,
            emoji: reaction.emoji,
            eventId: event.id,
            pendingEvent: event as unknown as object,
          },
        })
      ).id;
    } catch (error) {
      if (isPrismaUniqueViolation(error)) continue;
      throw error;
    }
    const sent = await deliver(input.relayUrl, event, (fresh) =>
      prisma.buzzReactionLink.update({
        where: { id: linkId },
        data: { eventId: fresh.id, pendingEvent: fresh as unknown as object },
      }),
    );
    await prisma.buzzReactionLink.update({
      where: { id: linkId },
      data: { pendingEvent: PrismaNull.DbNull, eventId: sent.id },
    });
  }

  for (const link of links) {
    if (wanted.has(key(link.identity.userId, link.emoji))) continue;
    // Their own app key's reaction: only they can take it back on Buzz.
    if (link.signerPubkey) {
      await prisma.buzzReactionLink.delete({ where: { id: link.id } });
      continue;
    }
    const event = signEvent(
      vouched(
        link.identity,
        deletionDraft({ channelId: input.channelId, eventId: link.eventId }),
      ),
      identitySecretKey(link.identity),
    );
    await prisma.buzzReactionLink.update({
      where: { id: link.id },
      data: { pendingEvent: event as unknown as object },
    });
    await deliver(input.relayUrl, event, (fresh) =>
      prisma.buzzReactionLink.update({
        where: { id: link.id },
        data: { pendingEvent: fresh as unknown as object },
      }),
    );
    await prisma.buzzReactionLink.delete({ where: { id: link.id } });
  }
}

/** How long a message must be quiet before it is sent, so a streaming reply goes out once. */
export const OUTBOX_SETTLE_MS = 2_000;

/** Backoff between attempts at one message: 5 s doubling, at most 10 min. */
export function outboxRetryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** attempts, 10 * 60_000);
}

/**
 * Works through the outbox: each message whose last change is older than
 * {@link OUTBOX_SETTLE_MS} is reconciled once, then its rows are dropped. A
 * failure keeps the rows and waits ({@link outboxRetryDelayMs}); the rows
 * are the only record of work Buzz has not seen, so they are never dropped
 * unfinished.
 */
export async function drainBuzzOutbox(
  options: { limit?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const rows = await prisma.buzzOutbox.findMany({
    where: { nextAttemptAt: { lte: now } },
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

  // A busy message can have newer rows beyond this page: settle on its newest.
  const newest = await prisma.buzzOutbox.groupBy({
    by: ["messageId"],
    where: {
      messageId: {
        in: [...latest.keys()].filter((key) => !key.startsWith("room:")),
      },
    },
    _max: { createdAt: true },
  });
  for (const row of newest) {
    const entry = row.messageId ? latest.get(row.messageId) : undefined;
    if (entry && row._max.createdAt && row._max.createdAt > entry.createdAt) {
      entry.createdAt = row._max.createdAt;
    }
  }

  const outcomes: { key: string; result: string }[] = [];
  for (const [key, entry] of latest) {
    if (now.getTime() - entry.createdAt.getTime() < OUTBOX_SETTLE_MS) {
      // Not quiet yet: wait out the rest, so the page reaches other work.
      await prisma.buzzOutbox.updateMany({
        where: { id: { in: entry.ids } },
        data: {
          nextAttemptAt: new Date(entry.createdAt.getTime() + OUTBOX_SETTLE_MS),
        },
      });
      continue;
    }
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
      await prisma.buzzOutbox.updateMany({
        where: { id: { in: entry.ids } },
        data: {
          attempts: entry.attempts + 1,
          lastError: reason.slice(0, 500),
          nextAttemptAt: new Date(
            now.getTime() + outboxRetryDelayMs(entry.attempts),
          ),
        },
      });
      outcomes.push({ key, result: `error: ${reason}` });
    }
  }
  return outcomes;
}

// ---------------------------------------------------------------- inbound

/**
 * A person added or removed their own personal agent in a Buzz channel: the
 * same change in Sokosumi, as them, under the same rules (only its owner,
 * only where the organization allows it). Anything else on Buzz is put back
 * by the next member sync, since Sokosumi's rooms decide who is in.
 */
async function applyMemberChange(
  event: Event,
  change: { added: boolean; pubkeys: string[] },
  author: BuzzIdentity,
  core: CoreRequest,
): Promise<InboundResult> {
  if (!author.userId) return "ignored";
  const channelId = channelIdOf(event);
  const channel = channelId
    ? await prisma.buzzChannel.findUnique({
        where: { channelId },
        include: { community: { select: { relayUrl: true } } },
      })
    : null;
  if (!channel || isDirect(channel)) return "ignored";
  // An agent made a moment ago is added before the agent sweep has seen it:
  // look for this person's agents now, or the member sync below removes it.
  if (change.added) {
    const known = await prisma.buzzIdentity.count({
      where: { pubkey: { in: change.pubkeys } },
    });
    if (known < change.pubkeys.length) {
      await syncBuzzAgents({ identityId: author.id });
    }
  }
  // Whatever happens below, the room's members are checked against Buzz
  // again: a change Sokosumi does not take (someone else invited, an agent
  // not allowed) is put back instead of lingering.
  await prisma.buzzChannel.update({
    where: { id: channel.id },
    data: { membersHash: null },
  });
  await prisma.buzzOutbox.create({
    data: { roomId: channel.roomId, messageId: null },
  });
  const agents = await prisma.buzzIdentity.findMany({
    where: {
      pubkey: { in: change.pubkeys },
      ownerIdentityId: author.id,
      coworkerId: { not: null },
    },
    select: { pubkey: true, coworkerId: true },
  });
  if (agents.length === 0) return "ignored";
  // A replayed invite or removal (the worker reads back after a restart)
  // must not undo a later change: only what the channel still shows applies.
  const current = await channelMemberPubkeys(
    channel.community.relayUrl,
    channel.channelId,
  );
  const coworkerIds = agents.flatMap((agent) =>
    agent.coworkerId && current.has(agent.pubkey) === change.added
      ? [agent.coworkerId]
      : [],
  );
  if (coworkerIds.length === 0) return "ignored";
  if (change.added) {
    await sendAs(core, author, {
      method: "POST",
      path: `/v1/chats/rooms/${channel.roomId}/members`,
      body: { coworkerIds },
    });
    return "members";
  }
  for (const coworkerId of coworkerIds) {
    const response = await core({
      method: "DELETE",
      path: `/v1/chats/rooms/${channel.roomId}/coworkers/${coworkerId}`,
      apiKey: await bridgeApiKeyFor(author),
    });
    // Already gone is what was asked.
    if (response.status >= 400 && response.status !== 404) {
      throw new CoreRejectedError(
        response.status,
        `Core DELETE coworker → ${response.status}`,
        errorKindOf(response.body),
      );
    }
  }
  return "members";
}

/** A Direct of just this person and one Coworker that answers over HTTP. */
async function isCoworkerDirect(roomId: string, author: BuzzIdentity) {
  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: {
      kind: true,
      userMembers: { select: { userId: true } },
      coworkerMembers: { select: { coworker: { select: { baseURL: true } } } },
      sokoBotMembers: { select: { sokoBotId: true } },
    },
  });
  return (
    room?.kind === "direct" &&
    room.userMembers.length === 1 &&
    room.userMembers[0]?.userId === author.userId &&
    room.sokoBotMembers.length === 0 &&
    room.coworkerMembers.length === 1 &&
    !isBuzzAgentBaseUrl(room.coworkerMembers[0]?.coworker.baseURL)
  );
}

/**
 * Asks the Coworker of a one-on-one Direct, as the person, through the
 * room's stream: Core stores the message and the Coworker's answer, which
 * then goes out to Buzz like any message. One turn per Buzz message: a
 * retry finds the message stored and only links it.
 */
async function postToCoworkerDirect(input: {
  core: CoreRequest;
  author: BuzzIdentity;
  roomId: string;
  clientMessageId: string;
  content: string;
  parentMessageId: string | undefined;
  eventId: string;
  signerPubkey: string | null;
  channelId: string;
}): Promise<InboundResult> {
  const stored = () =>
    prisma.chatRoomMessage.findFirst({
      where: {
        roomId: input.roomId,
        clientMessageId: input.clientMessageId,
        senderUserId: input.author.userId,
      },
      select: { id: true, createdAt: true },
    });
  let message = await stored();
  // Answered already (a worker that stopped before linking): only link.
  const answered =
    message &&
    (await prisma.chatRoomMessage.findFirst({
      where: {
        roomId: input.roomId,
        senderCoworkerId: { not: null },
        createdAt: { gt: message.createdAt },
      },
      select: { id: true },
    }));
  if (!answered) {
    // Core stores the message (once: same client id) and starts the turn;
    // the call returns when the answer has begun streaming. A turn that
    // does not start throws, so the event is retried, not lost.
    try {
      await sendAs(input.core, input.author, {
        method: "POST",
        path: `/v1/chats/rooms/${input.roomId}/stream`,
        timeoutMs: 15 * 60_000,
        streamed: true,
        body: {
          messages: [
            {
              id: input.clientMessageId,
              role: "user",
              parts: [{ type: "text", text: input.content }],
            },
          ],
          ...(input.parentMessageId
            ? { parentMessageId: input.parentMessageId }
            : {}),
        },
      });
    } catch (error) {
      // Another answer is still streaming in this room: ask again later.
      if (error instanceof CoreRejectedError && error.status === 409) {
        throw new CoreRejectedError(503, error.message, error.kind);
      }
      throw error;
    }
    message = await stored();
    if (!message) throw new Error("Core did not store the Direct message");
  }
  if (message) {
    await prisma.buzzMessageLink.upsert({
      where: { messageId: message.id },
      create: {
        messageId: message.id,
        eventId: input.eventId,
        contentHash: contentHash(input.content),
        signerPubkey: input.signerPubkey,
        channelId: input.channelId,
      },
      update: {},
    });
  }
  return "posted";
}

/** Buzz text with each `nostr:npub…` turned into the name Sokosumi knows. */
async function namedContent(content: string): Promise<string> {
  const pubkeys: string[] = [];
  readableContent(content, (pubkey) => {
    pubkeys.push(pubkey);
    return undefined;
  });
  if (pubkeys.length === 0) return content;
  const identities = await prisma.buzzIdentity.findMany({
    where: {
      OR: [{ pubkey: { in: pubkeys } }, { appPubkey: { in: pubkeys } }],
    },
    select: {
      pubkey: true,
      appPubkey: true,
      user: { select: { name: true } },
      sokoBot: { select: { name: true } },
      coworker: { select: { name: true } },
    },
  });
  const names = new Map<string, string | undefined>(
    identities.flatMap((identity) => {
      const name =
        identity.user?.name ??
        (identity.sokoBot ? sokoBotDisplayName(identity.sokoBot) : null) ??
        identity.coworker?.name ??
        undefined;
      return keysOf(identity).map((pubkey) => [pubkey, name] as const);
    }),
  );
  return readableContent(content, (pubkey) => names.get(pubkey));
}

/** Calls a Core route as a person, with their bridge API key. */
export type CoreRequest = (input: {
  method: "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  apiKey: string;
  body?: unknown;
  /** How long to wait; a Coworker's streamed answer can take minutes. */
  timeoutMs?: number;
  /** Answer as soon as a streamed response has started. */
  streamed?: boolean;
}) => Promise<{ status: number; body: unknown }>;

export async function bridgeApiKeyFor(identity: BuzzIdentity) {
  const config = requireConfig();
  if (identity.encryptedApiKey) {
    return openSecret(identity.encryptedApiKey, config.encryptionSecret);
  }
  if (identity.coworkerId && isExternal(identity)) {
    // A Buzz agent posts through Core as its Coworker.
    const token = generateCoworkerApiKeyToken();
    await prisma.$transaction([
      prisma.coworkerApiKey.create({
        data: {
          coworkerId: identity.coworkerId,
          name: "Buzz bridge",
          keyHash: await hashApiKey(token),
          keyStart: token.slice(0, COWORKER_API_KEY_START_LENGTH),
        },
      }),
      prisma.buzzIdentity.update({
        where: { id: identity.id },
        data: { encryptedApiKey: sealSecret(token, config.encryptionSecret) },
      }),
    ]);
    return token;
  }
  if (!identity.userId) throw new Error("Only people post through Core");
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
  | "members"
  | "posted"
  | "edited"
  | "deleted"
  | "reacted"
  | "unreacted"
  | "echo"
  | "ignored";

/** Core refused a replayed change; a client error will not change on retry. */
export class CoreRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Core's error kind, e.g. `concurrency_conflict` (a 409 worth retrying). */
    readonly kind?: string,
  ) {
    super(message);
  }

  get terminal(): boolean {
    if (this.kind === "concurrency_conflict") return false;
    return (
      this.status >= 400 &&
      this.status < 500 &&
      ![401, 403, 408, 429].includes(this.status)
    );
  }
}

function errorKindOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const kind =
    record.kind ??
    (record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>).kind
      : undefined);
  return typeof kind === "string" ? kind : undefined;
}

async function sendAs(
  core: CoreRequest,
  identity: BuzzIdentity,
  request: Omit<Parameters<CoreRequest>[0], "apiKey">,
) {
  const response = await core({
    ...request,
    apiKey: await bridgeApiKeyFor(identity),
  });
  // A 409 on a message means its clientMessageId is someone else's.
  if (response.status >= 400) {
    throw new CoreRejectedError(
      response.status,
      `Core ${request.method} ${request.path} → ${response.status}: ${JSON.stringify(response.body).slice(0, 300)}`,
      errorKindOf(response.body),
    );
  }
  return response;
}

/**
 * The event points at a message the bridge has not linked yet (it may still be
 * on its way in). Retry it; on the last attempt the caller passes
 * `finalAttempt` and the event is applied as well as it can be.
 */
export class BuzzTargetPendingError extends Error {
  constructor(readonly targetEventId: string) {
    super(`Waiting for ${targetEventId.slice(0, 8)} to be linked`);
  }
}

/** Replays one Buzz event as the person who wrote it. */
export async function applyInboundEvent(
  event: Event,
  core: CoreRequest,
  options: { finalAttempt?: boolean } = {},
): Promise<InboundResult> {
  const config = requireConfig();
  // The relay checks signatures too; a bridge that acts as people does not
  // take that on trust.
  if (!verifyEvent(event)) return "ignored";
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

  const author = await prisma.buzzIdentity.findFirst({
    where: { OR: [{ pubkey: event.pubkey }, { appPubkey: event.pubkey }] },
  });
  // Bots and coworkers speak only through Sokosumi, except a person's own
  // Buzz agent; strangers are not members.
  if (!author) return "ignored";
  const agent = Boolean(author.coworkerId) && isExternal(author);
  if (!author.userId && !agent) return "ignored";
  // An agent only posts: Core lets Coworkers write messages, not edit,
  // delete or react.
  if (agent && change.type !== "message") return "ignored";
  // Seen on Buzz: the person is connected (refreshed at most every minute).
  if (
    author.userId &&
    (!author.lastActiveOnBuzzAt ||
      Date.now() - author.lastActiveOnBuzzAt.getTime() > 60_000)
  ) {
    await prisma.buzzIdentity.update({
      where: { id: author.id },
      data: { lastActiveOnBuzzAt: new Date() },
    });
  }
  if (change.type === "members") {
    return applyMemberChange(event, change, author, core);
  }
  const signerPubkey =
    event.pubkey === author.pubkey && !agent ? null : event.pubkey;

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
        if (!parent && !options.finalAttempt) {
          throw new BuzzTargetPendingError(change.replyToEventId);
        }
        // Sokosumi threads are one level deep: answer the thread's root.
        parentMessageId = parent
          ? (parent.message.parentMessageId ?? parent.message.id)
          : undefined;
      }
      const mentioned = await prisma.buzzIdentity.findMany({
        where: {
          OR: [
            { pubkey: { in: change.mentionPubkeys } },
            { appPubkey: { in: change.mentionPubkeys } },
          ],
        },
        select: {
          pubkey: true,
          appPubkey: true,
          userId: true,
          sokoBotId: true,
          coworkerId: true,
          user: { select: { name: true } },
          sokoBot: { select: { name: true } },
          coworker: { select: { name: true } },
        },
      });
      const names = new Map(
        mentioned.flatMap((identity) => {
          const name =
            identity.user?.name ??
            (identity.sokoBot ? sokoBotDisplayName(identity.sokoBot) : null) ??
            identity.coworker?.name ??
            undefined;
          return keysOf(identity).map((pubkey) => [pubkey, name] as const);
        }),
      );
      const content = readableContent(change.content, (pubkey) =>
        names.get(pubkey),
      );
      const clientMessageId = `buzz:${event.id}`;
      // A one-on-one Direct with a Coworker is answered through the room's
      // stream (what Sokosumi's own clients call); a plain post would sit
      // there unanswered.
      if (!agent && (await isCoworkerDirect(channel.roomId, author))) {
        return postToCoworkerDirect({
          core,
          author,
          roomId: channel.roomId,
          clientMessageId,
          content,
          parentMessageId,
          eventId: event.id,
          signerPubkey,
          channelId: channel.channelId,
        });
      }
      const response = await sendAs(core, author, {
        method: "POST",
        path: `/v1/chats/rooms/${channel.roomId}/messages`,
        body: {
          content,
          clientMessageId,
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
      // Link now, not when the outbox settles: a reply, edit or reaction to
      // this message may be the very next event.
      const created = (response.body as { data?: { id?: unknown } } | null)
        ?.data?.id;
      const messageId =
        typeof created === "string"
          ? created
          : (
              await prisma.chatRoomMessage.findFirst({
                where: agent
                  ? {
                      roomId: channel.roomId,
                      clientMessageId,
                      senderCoworkerId: author.coworkerId,
                    }
                  : {
                      roomId: channel.roomId,
                      clientMessageId,
                      senderUserId: author.userId,
                    },
                select: { id: true },
              })
            )?.id;
      if (messageId) {
        await prisma.buzzMessageLink.upsert({
          where: { messageId },
          create: {
            messageId,
            eventId: event.id,
            contentHash: contentHash(content),
            signerPubkey,
            channelId: channel.channelId,
          },
          update: {},
        });
      }
      return "posted";
    }
    // Each change goes to Core first and is recorded after: a worker that
    // stops in between replays the event and does it again (Core takes the
    // same edit, delete or reaction twice harmlessly), never drops it.
    case "edit": {
      const link = await prisma.buzzMessageLink.findUnique({
        where: { eventId: change.targetEventId },
        select: {
          messageId: true,
          contentHash: true,
          lastEditAt: true,
          lastEditEventId: true,
          deleted: true,
          message: { select: { roomId: true, deletedAt: true } },
        },
      });
      if (!link) {
        if (options.finalAttempt) return "ignored";
        throw new BuzzTargetPendingError(change.targetEventId);
      }
      // Gone in Sokosumi: nothing left to edit (Core would refuse for good).
      if (link.deleted || link.message.deletedAt) return "ignored";
      // The newest edit wins; on a tie the lower id, as Nostr orders
      // replaceable events. A replayed or late edit never undoes a newer one.
      const newer =
        event.created_at > link.lastEditAt ||
        (event.created_at === link.lastEditAt &&
          (link.lastEditEventId === null || event.id < link.lastEditEventId));
      if (!newer) return "echo";
      const content = await namedContent(change.content);
      const hash = contentHash(content);
      if (link.contentHash !== hash) {
        await sendAs(core, author, {
          method: "PATCH",
          path: `/v1/chats/rooms/${link.message.roomId}/messages/${link.messageId}`,
          body: { content },
        });
      }
      await prisma.buzzMessageLink.update({
        where: { messageId: link.messageId },
        data: {
          contentHash: hash,
          lastEditAt: event.created_at,
          lastEditEventId: event.id,
        },
      });
      return link.contentHash === hash ? "echo" : "edited";
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
          await sendAs(core, author, {
            method: "DELETE",
            path: `/v1/chats/rooms/${messageLink.message.roomId}/messages/${messageLink.messageId}`,
          });
          await prisma.buzzMessageLink.update({
            where: { messageId: messageLink.messageId },
            data: { deleted: true },
          });
          result = "deleted";
          continue;
        }
        const reactionLink = await prisma.buzzReactionLink.findUnique({
          where: { eventId: targetEventId },
        });
        if (!reactionLink) {
          if (!options.finalAttempt) {
            throw new BuzzTargetPendingError(targetEventId);
          }
          continue;
        }
        // Our own take-back of a reaction Sokosumi already removed.
        if (isBeingRemoved(reactionLink)) continue;
        if (reactionLink.identityId !== author.id) continue;
        const message = await prisma.chatRoomMessage.findUnique({
          where: { id: reactionLink.messageId },
          select: { roomId: true },
        });
        if (message) {
          await sendAs(core, author, {
            method: "DELETE",
            path: `/v1/chats/rooms/${message.roomId}/messages/${reactionLink.messageId}/reactions/${encodeURIComponent(reactionLink.emoji)}`,
          });
        }
        await prisma.buzzReactionLink.deleteMany({
          where: { id: reactionLink.id },
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
      if (!link) {
        if (options.finalAttempt) return "ignored";
        throw new BuzzTargetPendingError(change.targetEventId);
      }
      const existing = await prisma.buzzReactionLink.findUnique({
        where: {
          messageId_identityId_emoji: {
            messageId: link.messageId,
            identityId: author.id,
            emoji: change.emoji,
          },
        },
      });
      if (existing) return "echo";
      await sendAs(core, author, {
        method: "PUT",
        path: `/v1/chats/rooms/${link.message.roomId}/messages/${link.messageId}/reactions/${encodeURIComponent(change.emoji)}`,
      });
      try {
        await prisma.buzzReactionLink.create({
          data: {
            messageId: link.messageId,
            identityId: author.id,
            emoji: change.emoji,
            eventId: event.id,
            signerPubkey,
          },
        });
      } catch (error) {
        if (!isPrismaUniqueViolation(error)) throw error;
      }
      return "reacted";
    }
  }
}

/**
 * What the worker reads, per community: one reader per key. The operator owns
 * every channel; a DM holds only its people, so one of them reads it.
 */
export async function buzzSubscriptions() {
  const communities = await prisma.buzzCommunity.findMany({
    select: {
      id: true,
      relayUrl: true,
      inboundCursor: true,
      channels: {
        select: {
          channelId: true,
          membersHash: true,
          room: {
            select: {
              userMembers: {
                select: { user: { select: { buzzIdentity: true } } },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });
  return communities.map((community) => {
    const readers = new Map<
      string,
      { readerId: string; channelIds: string[] }
    >();
    for (const channel of community.channels) {
      const readerId = isDirect(channel)
        ? (channel.room.userMembers.find((m) => m.user.buzzIdentity)?.user
            .buzzIdentity?.id ?? null)
        : "operator";
      if (!readerId) continue;
      const reader = readers.get(readerId) ?? { readerId, channelIds: [] };
      reader.channelIds.push(channel.channelId);
      readers.set(readerId, reader);
    }
    return {
      communityId: community.id,
      relayUrl: community.relayUrl,
      inboundCursor: community.inboundCursor,
      readers: [...readers.values()],
    };
  });
}

/** The key a reader subscribes with: the operator's, or a DM member's. */
export async function readerSecretKey(readerId: string): Promise<Uint8Array> {
  if (readerId === "operator") return requireConfig().operatorSecretKey;
  return identitySecretKey(
    await prisma.buzzIdentity.findUniqueOrThrow({ where: { id: readerId } }),
  );
}

/** Everything up to `cursor` (unix seconds) has been applied; never moves back. */
export async function saveInboundCursor(communityId: string, cursor: number) {
  await prisma.buzzCommunity.updateMany({
    where: { id: communityId, inboundCursor: { lt: cursor } },
    data: { inboundCursor: cursor },
  });
}

/**
 * Every linked room, for the worker's periodic member check: a membership can
 * change (someone leaves the organization) without any message to carry it.
 */
export async function linkedBuzzRooms() {
  return prisma.buzzChannel.findMany({ select: { roomId: true } });
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
