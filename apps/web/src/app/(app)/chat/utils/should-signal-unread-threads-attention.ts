import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * Whether a realtime/hydrated room message should bump unread-threads attention.
 * Top-level messages and the current user's own replies never signal.
 */
export function shouldSignalUnreadThreadsAttention(
  message: Pick<ChatRoomMessage, "parentMessageId" | "sender">,
  currentUserId: string,
): boolean {
  if (!message.parentMessageId) {
    return false;
  }

  if (message.sender.type === "user") {
    return message.sender.user.id !== currentUserId;
  }

  if (message.sender.type === "coworker") {
    return true;
  }

  return false;
}
