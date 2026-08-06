import type { ChatRoom } from "@/lib/clients/generated/core";

export const ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT =
  "organization-chat-rooms-changed";

export interface OrganizationChatRoomsChangedDetail {
  /** Upsert this membership room into the sidebar (join/create/edit). */
  room?: ChatRoom | null;
  /**
   * Drop this room from the sidebar (leave). Required so a subsequent first-
   * page refetch cannot re-surface it via upsertFirstPageRooms' "keep older
   * rows" merge.
   */
  removedRoomId?: string;
}

function isChatRoom(
  value: ChatRoom | OrganizationChatRoomsChangedDetail,
): value is ChatRoom {
  // ChatRoom always carries membership arrays; leave/remove detail does not.
  return "userMembers" in value && Array.isArray(value.userMembers);
}

/**
 * Soft-update the sidebar room list without `router.refresh()` (which re-ran
 * full layout RSC including paginated `listRooms`).
 *
 * - Pass a `ChatRoom` to upsert (join/create).
 * - Pass `{ removedRoomId }` after leave so the row drops immediately.
 * - Pass nothing to force a membership refetch.
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
