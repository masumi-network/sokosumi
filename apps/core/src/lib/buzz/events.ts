import { createHash } from "node:crypto";
import { decode as decodeNip19 } from "nostr-tools/nip19";
import type { Event } from "nostr-tools/pure";

/**
 * How Sokosumi chat maps onto Buzz events (NIP-29 groups as Buzz runs them).
 * Pure: no database, no network.
 *
 * Sokosumi       Buzz
 * room           channel (kind 9007, `h` = channel id)
 * message        kind 9, `["e", <thread root>, "", "reply"]` for a reply
 * edit           kind 40003, `e` = the message
 * delete         kind 5, `e` = the message (or reaction)
 * reaction       kind 7, content = emoji, `e` = the message
 * mention        `["p", <pubkey>]`
 */

export const BUZZ_KIND = {
  profile: 0,
  deletion: 5,
  reaction: 7,
  message: 9,
  addMember: 9000,
  removeMember: 9001,
  editChannel: 9002,
  adminDelete: 9005,
  createChannel: 9007,
  addCommunityMember: 9030,
  /** Relay-signed (NIP-43): a key was admitted to the community. */
  memberAdded: 8000,
  /** An owner's record of one of their Buzz agents; `d` is the agent's key. */
  agentRecord: 30177,
  openDirectMessage: 41010,
  richMessage: 40002,
  edit: 40003,
} as const;

/** Buzz direct messages hold at most nine people. */
export const MAX_DIRECT_MESSAGE_PEOPLE = 9;

/** The kinds the bridge reads from a channel. */
export const INBOUND_KINDS = [
  BUZZ_KIND.message,
  BUZZ_KIND.richMessage,
  BUZZ_KIND.edit,
  BUZZ_KIND.reaction,
  BUZZ_KIND.deletion,
  BUZZ_KIND.adminDelete,
];

export interface EventDraft {
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function messageDraft(input: {
  channelId: string;
  content: string;
  threadRootEventId?: string | null;
  mentionPubkeys?: readonly string[];
  createdAt?: Date;
}): EventDraft {
  const tags: string[][] = [["h", input.channelId]];
  if (input.threadRootEventId) {
    tags.push(["e", input.threadRootEventId, "", "reply"]);
  }
  for (const pubkey of new Set(input.mentionPubkeys ?? [])) {
    tags.push(["p", pubkey]);
  }
  return {
    kind: BUZZ_KIND.message,
    tags,
    content: input.content,
    ...(input.createdAt
      ? { created_at: Math.floor(input.createdAt.getTime() / 1000) }
      : {}),
  };
}

export function editDraft(input: {
  channelId: string;
  eventId: string;
  content: string;
}): EventDraft {
  return {
    kind: BUZZ_KIND.edit,
    tags: [
      ["h", input.channelId],
      ["e", input.eventId],
    ],
    content: input.content,
  };
}

export function deletionDraft(input: {
  channelId: string;
  eventId: string;
}): EventDraft {
  return {
    kind: BUZZ_KIND.deletion,
    tags: [
      ["h", input.channelId],
      ["e", input.eventId],
    ],
    content: "",
  };
}

export function reactionDraft(input: {
  channelId: string;
  eventId: string;
  authorPubkey: string;
  emoji: string;
}): EventDraft {
  return {
    kind: BUZZ_KIND.reaction,
    tags: [
      ["h", input.channelId],
      ["e", input.eventId],
      ["p", input.authorPubkey],
    ],
    content: input.emoji,
  };
}

export function profileDraft(input: {
  name: string;
  picture?: string | null;
  about?: string | null;
  bot?: boolean;
}): EventDraft {
  return {
    kind: BUZZ_KIND.profile,
    tags: [],
    content: JSON.stringify({
      name: input.name,
      display_name: input.name,
      ...(input.picture ? { picture: input.picture } : {}),
      ...(input.about ? { about: input.about } : {}),
      ...(input.bot ? { bot: true } : {}),
    }),
  };
}

export function createChannelDraft(input: {
  channelId: string;
  name: string;
  about?: string | null;
}): EventDraft {
  return {
    kind: BUZZ_KIND.createChannel,
    tags: [
      ["h", input.channelId],
      ["name", input.name],
      // Sokosumi decides who is in a room; Buzz mirrors that list.
      ["visibility", "private"],
      ...(input.about ? [["about", input.about]] : []),
    ],
    content: "",
  };
}

/** Opens (or finds) the DM of exactly these people, signed by one of them. */
export function openDirectMessageDraft(
  otherPubkeys: readonly string[],
): EventDraft {
  return {
    kind: BUZZ_KIND.openDirectMessage,
    tags: [...new Set(otherPubkeys)].map((pubkey) => ["p", pubkey]),
    content: "",
  };
}

/** The channel id in the relay's answer to {@link openDirectMessageDraft}. */
export function openedDirectMessageChannelId(
  message: string | null,
): string | null {
  if (!message?.startsWith("response:")) return null;
  try {
    const parsed = JSON.parse(message.slice("response:".length)) as {
      channel_id?: unknown;
    };
    return typeof parsed.channel_id === "string" ? parsed.channel_id : null;
  } catch {
    return null;
  }
}

export function channelMembersDraft(input: {
  channelId: string;
  kind: typeof BUZZ_KIND.addMember | typeof BUZZ_KIND.removeMember;
  members: readonly { pubkey: string; role?: "admin" | "member" | "bot" }[];
}): EventDraft {
  return {
    kind: input.kind,
    tags: [
      ["h", input.channelId],
      ...input.members.map((member) =>
        input.kind === BUZZ_KIND.addMember && member.role
          ? ["p", member.pubkey, "", member.role]
          : ["p", member.pubkey],
      ),
    ],
    content: "",
  };
}

export function communityMemberDraft(pubkey: string): EventDraft {
  return {
    kind: BUZZ_KIND.addCommunityMember,
    tags: [
      ["p", pubkey],
      ["role", "member"],
    ],
    content: "",
  };
}

function tagValues(event: Event, name: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1] as string);
}

export function channelIdOf(event: Event): string | null {
  return tagValues(event, "h")[0] ?? null;
}

/** The event a reply answers: a `reply` marker, else `root`, else the last `e`. */
function replyTarget(event: Event): string | null {
  const eTags = event.tags.filter(
    (tag) => tag[0] === "e" && typeof tag[1] === "string",
  );
  return (
    eTags.find((tag) => tag[3] === "reply")?.[1] ??
    eTags.find((tag) => tag[3] === "root")?.[1] ??
    eTags.at(-1)?.[1] ??
    null
  );
}

export type InboundChange =
  | {
      type: "message";
      replyToEventId: string | null;
      content: string;
      mentionPubkeys: string[];
    }
  | { type: "edit"; targetEventId: string; content: string }
  | { type: "delete"; targetEventIds: string[] }
  | { type: "reaction"; targetEventId: string; emoji: string }
  | { type: "ignore" };

export function readInbound(event: Event): InboundChange {
  switch (event.kind) {
    case BUZZ_KIND.message:
    case BUZZ_KIND.richMessage:
      return {
        type: "message",
        replyToEventId: replyTarget(event),
        content: event.content,
        mentionPubkeys: [...new Set(tagValues(event, "p"))],
      };
    case BUZZ_KIND.edit: {
      const target = tagValues(event, "e")[0];
      return target
        ? { type: "edit", targetEventId: target, content: event.content }
        : { type: "ignore" };
    }
    case BUZZ_KIND.deletion:
    case BUZZ_KIND.adminDelete: {
      const targets = tagValues(event, "e");
      return targets.length > 0
        ? { type: "delete", targetEventIds: targets }
        : { type: "ignore" };
    }
    case BUZZ_KIND.reaction: {
      // NIP-25: the reacted-to event is the last `e` tag.
      const target = tagValues(event, "e").at(-1);
      const emoji = event.content.trim();
      if (!target || !emoji) return { type: "ignore" };
      // "+" is NIP-25's like; Sokosumi stores emoji.
      return {
        type: "reaction",
        targetEventId: target,
        emoji: emoji === "+" ? "👍" : emoji,
      };
    }
    default:
      return { type: "ignore" };
  }
}

const NOSTR_REFERENCE =
  /nostr:(npub1[02-9ac-hj-np-z]+|nprofile1[02-9ac-hj-np-z]+)/g;

/**
 * Buzz clients may write a mention as a `nostr:npub…` reference. Sokosumi
 * shows `@Name`, so references to known people become their names.
 */
export function readableContent(
  content: string,
  nameOf: (pubkey: string) => string | undefined,
): string {
  return content.replace(NOSTR_REFERENCE, (whole, entity: string) => {
    try {
      const decoded = decodeNip19(entity);
      const pubkey =
        decoded.type === "npub"
          ? decoded.data
          : decoded.type === "nprofile"
            ? decoded.data.pubkey
            : null;
      const name = pubkey ? nameOf(pubkey) : undefined;
      return name ? `@${name}` : whole;
    } catch {
      return whole;
    }
  });
}

/**
 * A person's own Buzz agent, as a Coworker: its base URL names the relay it
 * lives on, and a mention of it is delivered by Buzz, not dispatched by
 * Sokosumi.
 */
export const BUZZ_AGENT_URL_PREFIX = "buzz://";

export function isBuzzAgentBaseUrl(baseURL: string | null | undefined) {
  return Boolean(baseURL?.startsWith(BUZZ_AGENT_URL_PREFIX));
}
