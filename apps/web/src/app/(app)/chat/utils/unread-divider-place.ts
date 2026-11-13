import type { RoomTranscriptPage } from "@/app/chat/utils/room-transcript-ranges";

/** Where the Unread divider sits; `at` keeps its place once its message goes. */
export interface UnreadDividerPlace {
  id: string;
  at: number | null;
}

/**
 * The divider an answer names: undefined when it names none (an older page)
 * or has not arrived, null for no Room unread or a failed read.
 */
export function unreadDividerIn(
  page: RoomTranscriptPage | null | undefined,
): UnreadDividerPlace | null | undefined {
  if (page === undefined) return undefined;
  const id = page ? page.firstUnreadMessageId : null;
  if (id === undefined) return undefined;
  if (!id) return null;
  const createdAt = page?.messages.find(
    (message) => message.id === id,
  )?.createdAt;
  return { id, at: createdAt == null ? null : new Date(createdAt).getTime() };
}
