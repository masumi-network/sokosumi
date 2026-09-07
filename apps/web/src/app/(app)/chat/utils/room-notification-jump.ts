import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * What a lookup found. A message that is gone and a lookup that failed are
 * different answers: the first is settled, the second may still come good.
 */
export type RoomNotificationLookup =
  | { status: "found"; message: ChatRoomMessage }
  | { status: "gone" }
  | { status: "unavailable" };

export interface RoomNotificationJumpDeps {
  /** True when the message is already rendered, which saves the lookup. */
  highlight: (messageId: string) => boolean;
  loadMessage: (messageId: string) => Promise<RoomNotificationLookup>;
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
 * A message that is gone leaves the reader in the room, which the
 * notification's own link already opened. Asking the room to scroll to an id
 * the server has just said nothing about would fail a second time, and loudly:
 * that second failure is what the reader would see, as an error about a
 * message somebody else deleted.
 *
 * A lookup that merely failed is different. The message is probably still
 * there, so the room jump is worth trying: it loads its own window and may
 * well succeed, and if it does not, its error is one the reader can act on.
 */
export async function performRoomNotificationJump(
  messageId: string,
  deps: RoomNotificationJumpDeps,
): Promise<void> {
  if (deps.highlight(messageId)) {
    return;
  }

  const lookup = await deps.loadMessage(messageId);

  if (lookup.status === "gone") {
    return;
  }

  if (lookup.status === "unavailable") {
    await deps.jumpInRoom(messageId);
    return;
  }

  if (lookup.message.parentMessageId) {
    await deps.jumpInThread(lookup.message);
    return;
  }

  await deps.jumpInRoom(lookup.message.id);
}
