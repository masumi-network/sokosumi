interface ReadableRoomMessage {
  id: string;
  content: string;
}

export interface RoomReadAttentionSnapshot {
  roomId: string | null;
  messages: readonly ReadableRoomMessage[];
  openThreadParentId: string | null;
  threadMessages: readonly ReadableRoomMessage[];
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

/** Compare content without serializing bodies or counting Thought metadata. */
export function sameRoomReadAttention(
  previous: RoomReadAttentionSnapshot | null,
  current: RoomReadAttentionSnapshot,
): boolean {
  return (
    previous !== null &&
    previous.roomId === current.roomId &&
    previous.openThreadParentId === current.openThreadParentId &&
    sameMessageContent(previous.messages, current.messages) &&
    sameMessageContent(previous.threadMessages, current.threadMessages)
  );
}
