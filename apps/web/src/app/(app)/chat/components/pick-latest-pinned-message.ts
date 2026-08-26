import type { ChatRoomPinnedMessageListItem } from "@/lib/clients/generated/core";

export function pickLatestPinnedMessage(
  items: readonly ChatRoomPinnedMessageListItem[],
): ChatRoomPinnedMessageListItem | null {
  const loadable = items.find((item) => item.message != null);
  return loadable ?? items[0] ?? null;
}
