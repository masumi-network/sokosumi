"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useChatControlChannel } from "@/hooks/effects/use-chat-control-channel";
import { chatQueryKeys } from "@/queries/chat";

import { notifyOrganizationChatRoomsChanged } from "./organization-chat-events";

/**
 * List-mounted control-channel UI. Invalidates membership-visible room queries
 * when kicked (SOK-746) and invalidates only the sidebar collections Core says
 * went stale after archive, restore, or invitation changes (SOK-986), even if
 * the open-room Ably island is not mounted.
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
      void queryClient.cancelQueries({
        queryKey: chatQueryKeys.anySidebarRooms(),
      });
      void queryClient.invalidateQueries({
        queryKey: chatQueryKeys.anySidebarRooms(),
        refetchType: "none",
      });
      notifyOrganizationChatRoomsChanged({ removedRoomId: event.roomId });
    },
    onRoomsChanged: (event) => {
      if (event.collections) {
        for (const collection of event.collections) {
          void queryClient.invalidateQueries({
            queryKey: chatQueryKeys.anySidebarRoomCollection(collection),
            refetchType: "none",
          });
        }
      } else {
        void queryClient.invalidateQueries({
          queryKey: chatQueryKeys.anySidebarRooms(),
          refetchType: "none",
        });
      }
      notifyOrganizationChatRoomsChanged({
        collections: event.collections,
        roomId: event.roomId,
      });
    },
  });

  return null;
}
