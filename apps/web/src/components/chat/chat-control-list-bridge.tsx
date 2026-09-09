"use client";

import { useChatControlChannel } from "@/lib/ably/use-chat-control-channel";

import { notifyOrganizationChatRoomsChanged } from "./organization-chat-events";

/**
 * List-mounted control-channel UI. Soft-removes membership-visible rooms when
 * kicked (SOK-746) and refetches only the sidebar collections Core says went
 * stale after archive, restore, or invitation changes (SOK-986), even if the
 * open-room Ably island is not mounted.
 *
 * Navigation/refresh lives only on the open-room bridge so both mounts never
 * double `replace`/`refresh` for the same event.
 */
export function ChatControlListBridge({
  currentUserId,
}: {
  currentUserId: string;
}) {
  useChatControlChannel({
    currentUserId,
    onRevoked: (event) => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: event.roomId });
    },
    onRoomsChanged: (event) => {
      notifyOrganizationChatRoomsChanged({ collections: event.collections });
    },
  });

  return null;
}
