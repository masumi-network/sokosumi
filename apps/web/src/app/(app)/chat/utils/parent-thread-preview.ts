import type {
  ChatRoomMessage,
  ChatRoomMessageSender,
} from "@/lib/clients/generated/core";

/** Same cap as Core `threadRepliers`. */
const MAX_THREAD_REPLY_FACES = 3;

function threadReplierKey(sender: ChatRoomMessageSender): string | null {
  switch (sender.type) {
    case "user":
      return `user:${sender.user.id}`;
    case "coworker":
      return `coworker:${sender.coworker.id}`;
    case "sokoBot":
      return `sokoBot:${sender.sokoBot.id}`;
    default:
      return null;
  }
}

/**
 * Local preview after this client posts a thread reply. Core does not
 * republish the parent, so the bar would otherwise keep the previous faces
 * next to a new age.
 */
export function applyReplyToParentThreadPreview(
  parent: ChatRoomMessage,
  reply: ChatRoomMessage,
): ChatRoomMessage {
  const key = threadReplierKey(reply.sender);
  const current = parent.threadRepliers ?? [];
  const threadRepliers = key
    ? [
        reply.sender,
        ...current.filter((replier) => threadReplierKey(replier) !== key),
      ].slice(0, MAX_THREAD_REPLY_FACES)
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
