import {
  senderKey,
  THREAD_REPLY_FACE_CAP,
} from "@/app/chat/components/room-helpers";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * Local preview after this client posts a thread reply. Core does not
 * republish the parent, so the bar would otherwise keep the previous faces
 * next to a new age.
 */
export function applyReplyToParentThreadPreview(
  parent: ChatRoomMessage,
  reply: ChatRoomMessage,
): ChatRoomMessage {
  // Repliers are in the order they joined, so a newcomer goes last and a
  // repeat replier keeps their place.
  const key = senderKey(reply.sender);
  const current = parent.threadRepliers ?? [];
  const threadRepliers =
    key && !current.some((replier) => senderKey(replier) === key)
      ? [...current, reply.sender].slice(0, THREAD_REPLY_FACE_CAP)
      : current;

  return {
    ...parent,
    threadReplyCount: parent.threadReplyCount + 1,
    threadLastReplyAt: reply.createdAt,
    threadRepliers,
  };
}

/**
 * After a live thread reply is soft-deleted, drop one from the parent's
 * threadReplyCount — but only if the parent still shows the pre-delete
 * count. If Ably already applied the server parent update, leave it.
 */
export function applyReplySoftDeleteToParentIfUnchanged(
  parent: ChatRoomMessage,
  parentMessageId: string,
  parentCountBefore: number,
): ChatRoomMessage {
  if (parent.id !== parentMessageId) {
    return parent;
  }
  if (parent.threadReplyCount !== parentCountBefore) {
    return parent;
  }

  const threadReplyCount = Math.max(0, parentCountBefore - 1);
  return {
    ...parent,
    threadReplyCount,
    threadLastReplyAt: threadReplyCount === 0 ? null : parent.threadLastReplyAt,
  };
}
