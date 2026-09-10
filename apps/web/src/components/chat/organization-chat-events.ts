import type { ChatRoomCollection } from "@sokosumi/utils";

import type { ChatRoom } from "@/lib/clients/generated/core";

export const ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT =
  "organization-chat-rooms-changed";

export interface OrganizationChatRoomsChangedDetail {
  /** Upsert this membership room into the sidebar (join/create/edit). */
  room?: ChatRoom | null;
  /**
   * Drop this room from the sidebar (leave) immediately, without waiting
   * for the next membership-visible rooms refetch.
   */
  removedRoomId?: string;
  /**
   * Refetch only these collections (SOK-986 control-channel invalidation or
   * a message in another room). Absent means refetch every collection.
   */
  collections?: readonly ChatRoomCollection[];
  /** The room the invalidation is about, when Core named one. */
  roomId?: string | null;
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
