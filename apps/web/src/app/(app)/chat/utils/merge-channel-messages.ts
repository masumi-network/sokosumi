import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/**
 * Merge channel message pages by id. Incoming rows win (fresh reactions /
 * mention status). Result is sorted oldest → newest for reading order.
 */
export function mergeChannelMessages(
  existing: readonly ChatRoomMessage[],
  incoming: readonly ChatRoomMessage[],
): ChatRoomMessage[] {
  const byId = new Map<string, ChatRoomMessage>();
  for (const message of existing) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).toSorted((left, right) => {
    const timeDelta =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}
