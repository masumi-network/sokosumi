import type { ChatRoomMessageEventData } from "./schema";
import {
  isChatRoomMessageIdEnvelope,
  isChatRoomMessagePatchEvent,
} from "./schema";

interface ReactionLike {
  reactedByCurrentUser: boolean;
  reactors: ReadonlyArray<{ id: string }>;
}

function isReactorEntry(value: unknown): value is { id: string } {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function isReactionLike(value: unknown): value is ReactionLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.reactors)) {
    return false;
  }
  // Wire data may be partial/malformed; only accept arrays of reactor objects.
  return record.reactors.every(isReactorEntry);
}

/**
 * Derive viewer-specific reaction flags from reactor ids (SOK-741).
 * Shared Ably wire DTO leaves reactedByCurrentUser false/meaningless.
 *
 * Note: Core caps named `reactors` (MAX_LISTED_CHAT_REACTION_REACTORS = 20).
 * If the viewer reacted but is outside that list, derive returns false until
 * the next REST load (personalized). Acceptable edge for Ably scale path.
 */
export function personalizeReactionsForViewer<T extends ReactionLike>(
  reactions: readonly T[],
  currentUserId: string,
): T[] {
  return reactions.map((reaction) => ({
    ...reaction,
    reactedByCurrentUser: reaction.reactors.some(
      (reactor) => reactor.id === currentUserId,
    ),
  }));
}

function personalizeUnknownReactions(
  reactions: readonly unknown[],
  currentUserId: string,
): unknown[] {
  return reactions.map((reaction) => {
    if (!isReactionLike(reaction)) {
      return reaction;
    }
    return personalizeReactionsForViewer([reaction], currentUserId)[0];
  });
}

/**
 * Personalize a chat_room_message Ably event for the signed-in viewer.
 */
export function personalizeChatRoomMessageEvent(
  event: ChatRoomMessageEventData,
  currentUserId: string,
): ChatRoomMessageEventData {
  if (isChatRoomMessagePatchEvent(event)) {
    if (event.eventType !== "reaction") {
      return event;
    }
    return {
      ...event,
      patch: {
        reactions: personalizeUnknownReactions(
          event.patch.reactions,
          currentUserId,
        ),
      },
    };
  }

  if (isChatRoomMessageIdEnvelope(event)) {
    return event;
  }

  return {
    ...event,
    message: {
      ...event.message,
      reactions: personalizeUnknownReactions(
        event.message.reactions,
        currentUserId,
      ),
    },
  };
}
