import type { ChatRoom } from "@/lib/clients/generated/core";

export const ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT =
  "organization-chat-rooms-changed";

/**
 * Soft-update the sidebar room list without `router.refresh()` (which re-ran
 * full layout RSC including paginated `listRooms`).
 */
export function notifyOrganizationChatRoomsChanged(
  channel?: ChatRoom | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
      detail: channel ? { channel } : {},
    }),
  );
}
