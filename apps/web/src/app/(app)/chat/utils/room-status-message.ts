import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * A row the room writes about itself (joined/left, Group name changes), not a
 * chat bubble: never grouped with bubbles, reacted to, quoted or dropped for
 * an empty body.
 */
export function isRoomStatusMessage(
  message: Pick<ChatRoomMessage, "membership" | "groupNameChange">,
): boolean {
  return message.membership != null || message.groupNameChange != null;
}
