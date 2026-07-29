import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { chatRoomService } from "@/lib/services";

/**
 * Room metadata is required to render the room page, but a transient Core 5xx
 * on `GET /v1/chats/rooms/{id}` must not crash the RSC — soft-land on `/chat`
 * instead (same idea as {@link loadRoomMessages} / {@link loadOrganizationMembers}).
 *
 * 403/404 already map to `room: null` inside {@link chatRoomService.getRoom}.
 */
export async function loadChatRoom(roomId: string): Promise<{
  room: ChatRoom | null;
  failed: boolean;
}> {
  try {
    const room = await chatRoomService.getRoom(roomId);
    return { room, failed: false };
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      console.error("Failed to load chat room", {
        roomId,
        status: error.status,
        kind: error.kind,
      });
      return { room: null, failed: true };
    }

    throw error;
  }
}
