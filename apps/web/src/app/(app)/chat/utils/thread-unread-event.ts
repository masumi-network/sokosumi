import {
  type ChatRoomMessageEventData,
  isChatRoomMessagePatchEvent,
} from "@/lib/ably/schema";

/**
 * Whether a realtime message event can change how many threads in this room
 * are unread.
 *
 * A reply never enters the room transcript, so an event about one is the only
 * word the open room gets that its unread thread count moved. Creates and
 * deletes both count: Core excludes deleted replies from the number.
 *
 * Field patches (a reaction, an unfurl, a mention status) are not new
 * messages and leave the count alone, even though they carry a parent id.
 *
 * The event arrives in two shapes: the full DTO, and the id envelope an
 * over-limit message falls back to (ADR 0014). Both carry the room and the
 * parent, in different places.
 */
export function isThreadUnreadEvent(
  event: ChatRoomMessageEventData,
  selectedRoomId: string | null,
): boolean {
  if (selectedRoomId == null || isChatRoomMessagePatchEvent(event)) {
    return false;
  }
  const { roomId, parentMessageId } =
    "message" in event ? event.message : event;
  return roomId === selectedRoomId && parentMessageId != null;
}
