"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useChatControlChannel } from "@/hooks/effects/use-chat-control-channel";
import { chatQueryKeys } from "@/queries/chat";
import {
  cancelAndInvalidateSidebarCollections,
  revokeSidebarRoom,
} from "@/queries/chat-sidebar-rooms";

import { notifyOrganizationChatRoomsChanged } from "./organization-chat-events";

/**
 * List-mounted control-channel UI. Cancels and invalidates membership-visible
 * room queries when kicked (SOK-746) — removing the revoked room from cached
 * lists immediately — and cancels and invalidates only the sidebar collections
 * Core says went stale after archive, restore, or invitation changes (SOK-986),
 * even if the open-room Ably island is not mounted.
 *
 * The sidebar and the mobile nav may both mount this. The hook subscribes
 * once and notifies once, so two islands never double-fetch.
 *
 * Navigation/refresh lives only on the open-room bridge so both mounts never
 * double `replace`/`refresh` for the same event.
 */
export function ChatControlListBridge({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const queryClient = useQueryClient();

  useChatControlChannel({
    currentUserId,
    onRevoked: (event) => {
      revokeSidebarRoom(queryClient, event.roomId);
      notifyOrganizationChatRoomsChanged({ removedRoomId: event.roomId });
    },
    onRoomsChanged: (event) => {
      const keys = event.collections
        ? event.collections.map((collection) =>
            chatQueryKeys.anySidebarRoomCollection(collection),
          )
        : [chatQueryKeys.anySidebarRooms()];
      cancelAndInvalidateSidebarCollections(queryClient, keys);
      notifyOrganizationChatRoomsChanged({
        collections: event.collections,
        roomId: event.roomId,
      });
    },
  });

  return null;
}
