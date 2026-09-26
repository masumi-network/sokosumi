import { MAX_LISTED_CHAT_REACTION_REACTORS } from "@sokosumi/utils";

import type {
  ChatRoomMessage,
  ChatRoomMessageReaction,
} from "@/lib/clients/generated/core";

/** The viewer's add or remove of one emoji on one message, shown before confirm. */
export interface PendingReaction {
  messageId: string;
  emoji: string;
  reacted: boolean;
}

/** Who to list among the reactors; `name` is null when the roster has no row. */
export interface PendingReactionViewer {
  id: string;
  name: string | null;
}

export type PendingReactionKey = `${string}:${string}`;

export function pendingReactionKey(
  messageId: string,
  emoji: string,
): PendingReactionKey {
  return `${messageId}:${emoji}`;
}

function addViewer(
  entry: ChatRoomMessageReaction | undefined,
  emoji: string,
  viewer: PendingReactionViewer,
): ChatRoomMessageReaction {
  const reactors = entry?.reactors ?? [];
  // Reactors are listed by reaction time and capped; a fresh tap is last.
  const listed =
    viewer.name != null && reactors.length < MAX_LISTED_CHAT_REACTION_REACTORS
      ? [...reactors, { id: viewer.id, name: viewer.name }]
      : reactors;
  return {
    emoji,
    count: (entry?.count ?? 0) + 1,
    reactedByCurrentUser: true,
    reactors: listed,
  };
}

function removeViewer(
  entry: ChatRoomMessageReaction,
  viewer: PendingReactionViewer,
): ChatRoomMessageReaction | null {
  const count = entry.count - 1;
  if (count <= 0) {
    return null;
  }
  return {
    ...entry,
    count,
    reactedByCurrentUser: false,
    reactors: entry.reactors.filter((reactor) => reactor.id !== viewer.id),
  };
}

/**
 * Overlay one Pending reaction on a confirmed message. Idempotent: a message
 * that already matches the intent comes back as the same object, so rows
 * without a change keep their identity.
 */
export function applyPendingReaction(
  message: ChatRoomMessage,
  pending: PendingReaction,
  viewer: PendingReactionViewer,
): ChatRoomMessage {
  const index = message.reactions.findIndex(
    (entry) => entry.emoji === pending.emoji,
  );
  const entry = index === -1 ? undefined : message.reactions[index];
  if ((entry?.reactedByCurrentUser ?? false) === pending.reacted) {
    return message;
  }

  const reactions = [...message.reactions];
  if (pending.reacted) {
    const next = addViewer(entry, pending.emoji, viewer);
    if (index === -1) {
      reactions.push(next);
    } else {
      reactions[index] = next;
    }
  } else if (entry) {
    const next = removeViewer(entry, viewer);
    if (next) {
      reactions[index] = next;
    } else {
      reactions.splice(index, 1);
    }
  }
  return { ...message, reactions };
}

/** Every Pending reaction for this message, on top of its confirmed entries. */
export function overlayPendingReactions(
  message: ChatRoomMessage,
  pending: ReadonlyMap<PendingReactionKey, PendingReaction>,
  viewer: PendingReactionViewer,
): ChatRoomMessage {
  let result = message;
  for (const intent of pending.values()) {
    if (intent.messageId === message.id) {
      result = applyPendingReaction(result, intent, viewer);
    }
  }
  return result;
}

/**
 * Take only `emoji`'s entry from a reaction response. Other emoji, edits and
 * realtime updates that landed meanwhile stay as they are (ADR 0032).
 */
export function mergeConfirmedReaction(
  existing: ChatRoomMessage,
  response: ChatRoomMessage,
  emoji: string,
): ChatRoomMessage {
  const confirmed = response.reactions.find((entry) => entry.emoji === emoji);
  const index = existing.reactions.findIndex((entry) => entry.emoji === emoji);
  const reactions = [...existing.reactions];
  if (!confirmed) {
    if (index !== -1) {
      reactions.splice(index, 1);
    }
  } else if (index === -1) {
    reactions.push(confirmed);
  } else {
    reactions[index] = confirmed;
  }
  return { ...existing, reactions };
}
