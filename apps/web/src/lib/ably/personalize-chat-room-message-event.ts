import type { ChatRoomMessageEventData } from "./schema";
import { isChatRoomMessagePatchEvent } from "./schema";

interface ReactionLike {
  reactedByCurrentUser: boolean;
  reactors: ReadonlyArray<{ id: string }>;
}

function isReactionLike(value: unknown): value is ReactionLike {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.reactors);
}

/**
 * Derive viewer-specific reaction flags from reactor ids (SOK-741).
 * Shared Ably wire DTO leaves reactedByCurrentUser false/meaningless.
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
    return {
      ...reaction,
      reactedByCurrentUser: reaction.reactors.some(
        (reactor) => reactor.id === currentUserId,
      ),
    };
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
