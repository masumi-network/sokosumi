import type { ChatRoomMessageResults } from "@sokosumi/core-client";
import type { RoomMessagePage } from "@/app/chat/components/room-messages-hydrator";
import { chatRoomService } from "@/lib/services/chat-room.service";

/** Newest result messages whose cards an open shows first; older rows read on scroll. */
const OPENING_RESULT_MESSAGES = 20;

export interface RoomOpenHistory {
  messagesPromise: Promise<RoomMessagePage>;
  /** Null when the read failed; rows then read in the browser. */
  resultsPromise: Promise<ChatRoomMessageResults[] | null>;
}

/**
 * Start the room's latest page on the server once access is proven, so the
 * browser does not wait for hydrate to ask. Results follow the page in one
 * batched read. Neither promise rejects.
 */
export function loadRoomOpenHistory(roomId: string): RoomOpenHistory {
  const page = chatRoomService.listMessages(roomId);
  return {
    messagesPromise: page.then(
      ({ messages, nextCursor }) => ({ messages, nextCursor, failed: false }),
      () => ({ messages: [], nextCursor: null, failed: true }),
    ),
    resultsPromise: page
      .then(({ messages }) => {
        const ids = messages
          .filter((message) => message.resultPreviews?.length)
          .slice(-OPENING_RESULT_MESSAGES)
          .map((message) => message.id);
        return ids.length
          ? chatRoomService.listMessageResults(roomId, ids)
          : [];
      })
      .catch(() => null),
  };
}
