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
  options?: { cursor?: string; around?: string; limit?: number },
  onAccessDenied?: (status: number) => void,
): Promise<RoomMessagesPage | null> {
  const params = new URLSearchParams();
  if (parentMessageId) params.set("parentMessageId", parentMessageId);
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.around) params.set("around", options.around);
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.size ? `?${params}` : "";
  const data = await fetchBackgroundJson(
    `/api/chat/${encodeURIComponent(roomId)}/messages${query}`,
    ROOM_MESSAGE_REQUEST_TIMEOUT_MS,
    (status) => {
      if (
        status === 401 ||
        status === 403 ||
        (status === 404 &&
          !options?.around &&
          !options?.cursor &&
          !parentMessageId)
      )
        onAccessDenied?.(status);
    },
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
