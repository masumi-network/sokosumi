import type { ChatRoom } from "@sokosumi/core-client";
import type { ChatRoomCollection } from "@sokosumi/utils";

import { roomAttentionAfterRead } from "./room-attention";
import { applyRoomReadOverlays, rememberRoomRead } from "./room-read-overlay";

export const ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT =
  "organization-chat-rooms-changed";

export const ORGANIZATION_CHAT_ROOM_READ_EVENT = "organization-chat-room-read";

export interface OrganizationChatRoomsChangedDetail {
  /** Upsert this membership room into the sidebar (join/create/edit). */
  room?: ChatRoom | null;
  /**
   * Drop this room from the sidebar (leave) immediately, without waiting
   * for the next membership-visible rooms refetch.
   */
  removedRoomId?: string;
  /** Core confirmed a join; permits a fresh transcript after prior revocation. */
  joinedRoomId?: string;
  /**
   * Refetch only these collections (SOK-986 control-channel invalidation or
   * a message in another room). Absent means refetch every collection.
   */
  collections?: readonly ChatRoomCollection[];
  /** The room the invalidation is about, when Core named one. */
  roomId?: string | null;
}

export interface OrganizationChatRoomReadDetail {
  roomId?: string;
  /** Core's answer to the read. Absent, the row clears by the local rule. */
  room?: ChatRoom;
}

interface OrganizationChatRoomsChangedHandlers {
  onRemoved: (roomId: string) => void;
  /** Left out, a room handed over whole changes nothing here. */
  onRoom?: (room: ChatRoom) => void;
  /** Absent `collections` means every collection. */
  onInvalidated?: (collections?: readonly ChatRoomCollection[]) => void;
}

/** What a rooms-changed event asks of a surface holding a copy of the rooms. */
export function subscribeOrganizationChatRoomsChanged({
  onRemoved,
  onRoom,
  onInvalidated,
}: OrganizationChatRoomsChangedHandlers): () => void {
  const handleRoomsChanged = (event: Event) => {
    const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
      .detail;
    if (detail?.removedRoomId) {
      onRemoved(detail.removedRoomId);
      return;
    }
    if (detail?.room) {
      onRoom?.(detail.room);
      return;
    }
    onInvalidated?.(detail?.collections);
  };

  window.addEventListener(
    ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
    handleRoomsChanged,
  );
  return () => {
    window.removeEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
  };
}

/**
 * Apply a room read to a surface's copy of the rooms. `mergeRead` is for a copy
 * holding what Core's answer to the read does not carry.
 */
export function subscribeOrganizationChatRoomRead(
  updateRooms: (apply: (rooms: ChatRoom[]) => ChatRoom[]) => void,
  mergeRead: (current: ChatRoom, read: ChatRoom) => ChatRoom = (_, read) =>
    read,
): () => void {
  const handleRoomRead = (event: Event) => {
    const { roomId, room: read } =
      (event as CustomEvent<OrganizationChatRoomReadDetail | undefined>)
        .detail ?? {};
    if (!roomId) {
      return;
    }

    if (read) {
      // Dual-baseline: leftover Participant Thread unread stays on the row.
      rememberRoomRead(read);
    }

    updateRooms((rooms) =>
      applyRoomReadOverlays(
        rooms.map((room) => {
          if (room.id !== roomId) return room;
          if (read) return mergeRead(room, read);
          const updated = { ...room, ...roomAttentionAfterRead(room) };
          rememberRoomRead(updated);
          return updated;
        }),
      ),
    );
  };

  window.addEventListener(ORGANIZATION_CHAT_ROOM_READ_EVENT, handleRoomRead);
  return () => {
    window.removeEventListener(
      ORGANIZATION_CHAT_ROOM_READ_EVENT,
      handleRoomRead,
    );
  };
}

function isChatRoom(
  value: ChatRoom | OrganizationChatRoomsChangedDetail,
): value is ChatRoom {
  // ChatRoom always carries membership arrays; leave/remove detail does not.
  return "userMembers" in value && Array.isArray(value.userMembers);
}

/**
 * Soft-update the sidebar room list without `router.refresh()` (which re-ran
 * full layout RSC including `listRooms`).
 *
 * - Pass a `ChatRoom` to upsert (join/create).
 * - Pass `{ removedRoomId }` after leave so the row drops immediately.
 * - Pass `{ collections }` to refetch only the named collections.
 * - Pass nothing to force a refetch of every collection.
 */
export function notifyOrganizationChatRoomsChanged(
  roomOrDetail?: ChatRoom | OrganizationChatRoomsChangedDetail | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  let detail: OrganizationChatRoomsChangedDetail = {};
  if (roomOrDetail != null) {
    detail = isChatRoom(roomOrDetail) ? { room: roomOrDetail } : roomOrDetail;
  }

  window.dispatchEvent(
    new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
      detail,
    }),
  );
}
