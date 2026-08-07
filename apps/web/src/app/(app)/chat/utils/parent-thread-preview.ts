import type { ChatRoomMessage } from "@/lib/clients/generated/core";

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
