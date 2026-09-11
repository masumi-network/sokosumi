import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * What a lookup found. `notReadable` and `unavailable` are different answers:
 * the first is settled, the second may still come good.
 *
 * `notReadable` covers both settled ways there is nothing to act on. Core
 * refused the message, or the reader moved to another room while it was being
 * read, which makes the answer theirs no longer.
 */
export type RoomNotificationLookup =
  | { status: "found"; message: ChatRoomMessage }
  | { status: "notReadable" }
  | { status: "unavailable" };

export interface RoomNotificationJumpDeps {
  /**
   * True when the message is already in the room transcript, which saves the
   * lookup. Scoped to the transcript on purpose: a reply is rendered in the
   * thread panel, and answering for it there would end the jump with the
   * transcript still sitting on the newest message.
   */
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
 * The read is skipped when the message is already in the room transcript,
 * which is the common case for a room the reader is looking at. A reply does
 * not answer it, even when its thread is open on screen, because the room
 * behind that thread still has to be put on the parent.
 *
 * A message the reader cannot read stops the jump and nothing else. Usually
 * that leaves them in the room the notification's own link opened, and asking
 * it to scroll to an id the server has just refused would fail a second time,
 * and loudly, and that second failure is what the reader would see. The other
 * producer of this status is a reader who has since moved to another room,
 * where stopping is just as right: the answer is no longer theirs.
 *
 * A soft delete is not this case. It comes back as its tombstone with a 200,
 * and a top-level one is landed on. A reply is landed on too, unless its
 * parent has to be fetched: that read goes through Core's thread aggregate,
 * which counts only live replies, so a deleted reply that was the last one
 * leaves no thread to open. A parent already in the loaded timeline is never
 * fetched, and the reply list it opens does not filter deleted replies, so
 * the reader lands on the tombstone. A refusal means the room was archived,
 * or they
 * are no longer a member of it or of the organization behind it, or the id
 * names nothing in that room, which is where a hard delete lands. Being left
 * in the room is the useful answer to all of those.
 *
 * A lookup that merely failed is different. The message is probably still
 * there, so the room jump is worth trying: it loads its own window and may
 * well land it. What it cannot do is tell a reply apart from a top-level
 * message, because that is what the failed lookup was for. Core re-centres an
 * `around` request for a reply on its parent, so the window loads, the
 * highlight finds nothing, and the reader is left in the room without a
 * word. That is the same place a refusal leaves them.
 */
export async function performRoomNotificationJump(
  messageId: string,
  deps: RoomNotificationJumpDeps,
): Promise<void> {
  if (deps.highlight(messageId)) {
    return;
  }

  const lookup = await deps.loadMessage(messageId);

  if (lookup.status === "notReadable") {
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
