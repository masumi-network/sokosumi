import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { getChatsRoomsByIdMessagesResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

import { fetchBackgroundJson } from "./fetch-background-json";

const ROOM_MESSAGE_REQUEST_TIMEOUT_MS = 30_000;

export interface RoomMessagesPage {
  messages: ChatRoomMessage[];
  nextCursor: string | null;
}

/**
 * Background read of a room's latest page, or of one thread when a parent
 * message is named (SOK-986). Null on any failure so a late or failed read
 * never replaces newer local messages.
 */
export async function fetchRoomMessages(
  roomId: string,
  parentMessageId?: string | null,
): Promise<RoomMessagesPage | null> {
  const query = parentMessageId
    ? `?parentMessageId=${encodeURIComponent(parentMessageId)}`
    : "";
  const data = await fetchBackgroundJson(
    `/api/chat/${encodeURIComponent(roomId)}/messages${query}`,
    ROOM_MESSAGE_REQUEST_TIMEOUT_MS,
  );
  if (data == null) return null;
  try {
    const page = await getChatsRoomsByIdMessagesResponseTransformer(data);
    return {
      messages: page.data,
      nextCursor: page.meta.pagination.nextCursor,
    };
  } catch {
    return null;
  }
}
