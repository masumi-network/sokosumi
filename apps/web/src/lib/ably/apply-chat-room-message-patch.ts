import type { ChatRoomMessagePatchEventData } from "@/lib/ably/schema";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * Merge a high-chatter Ably patch into an existing client message.
 * Only the patch slice overwrites; all other fields stay.
 */
export function applyChatRoomMessagePatch(
  existing: ChatRoomMessage,
  event: ChatRoomMessagePatchEventData,
): ChatRoomMessage {
  switch (event.eventType) {
    case "reaction":
      return {
        ...existing,
        reactions: event.patch.reactions as ChatRoomMessage["reactions"],
      };
    case "unfurl":
      return {
        ...existing,
        unfurls: event.patch.unfurls as ChatRoomMessage["unfurls"],
      };
    case "mention_status":
      return {
        ...existing,
        mentions: event.patch.mentions as ChatRoomMessage["mentions"],
      };
  }
}
