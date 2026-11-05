interface ReadableRoomMessage {
  id: string;
  content: string;
}

export interface RoomReadAttentionSnapshot {
  roomId: string | null;
  messages: readonly ReadableRoomMessage[];
  openThreadParentId: string | null;
  threadMessages: readonly ReadableRoomMessage[];
  /** The room transcript is at its end, where Jump to latest is hidden. */
  transcriptAtEnd: boolean;
}

function sameMessageContent(
  previous: readonly ReadableRoomMessage[],
  current: readonly ReadableRoomMessage[],
): boolean {
  return (
    previous === current ||
    (previous.length === current.length &&
      previous.every((message, index) => {
        const other = current[index];
        return message.id === other.id && message.content === other.content;
      }))
  );
}

/**
 * Compare content without serializing bodies or counting Thought metadata.
 * A snapshot taken at the end of the transcript, where the room was read,
 * also covers the same content seen from above the end; one taken above the
 * end does not cover reaching it.
 */
export function sameRoomReadAttention(
  previous: RoomReadAttentionSnapshot | null,
  current: RoomReadAttentionSnapshot,
): boolean {
  return (
    previous !== null &&
    previous.roomId === current.roomId &&
    previous.openThreadParentId === current.openThreadParentId &&
    (previous.transcriptAtEnd || !current.transcriptAtEnd) &&
    sameMessageContent(previous.messages, current.messages) &&
    sameMessageContent(previous.threadMessages, current.threadMessages)
  );
}
