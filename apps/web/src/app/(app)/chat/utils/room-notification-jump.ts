import type { ChatRoomMessage } from "@/lib/clients/generated/core";

export interface RoomNotificationJumpDeps {
  /** True when the message is already rendered, which saves the lookup. */
  highlight: (messageId: string) => boolean;
  /** Null when the message is gone, or in a room the reader cannot read. */
  loadMessage: (messageId: string) => Promise<ChatRoomMessage | null>;
  jumpInRoom: (messageId: string) => Promise<void>;
  jumpInThread: (message: ChatRoomMessage) => Promise<void>;
}

/**
 * Open the message a notification named, wherever it lives.
 *
 * A notification carries a message id and nothing else, and a reply does not
 * appear in the room timeline: it lives in a thread whose parent the id does
 * not name. So the message is read first, and where it turns out to live
 * decides which jump runs.
 *
 * The read is skipped when the message is already on screen, which is the
 * common case for a room the reader is looking at.
 *
 * A message that cannot be read still opens its room. The reader asked to go
 * somewhere, and the room is the honest answer when the message is gone.
 */
export async function performRoomNotificationJump(
  messageId: string,
  deps: RoomNotificationJumpDeps,
): Promise<void> {
  if (deps.highlight(messageId)) {
    return;
  }

  const message = await deps.loadMessage(messageId);
  if (!message) {
    await deps.jumpInRoom(messageId);
    return;
  }

  if (message.parentMessageId) {
    await deps.jumpInThread(message);
    return;
  }

  await deps.jumpInRoom(message.id);
}
