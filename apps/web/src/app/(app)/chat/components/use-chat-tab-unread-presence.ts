"use client";

import { countChatRoomsWithUnreadAttention } from "@/components/chat/chat-unread-document-title";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";
import { useLiveOtherWorkspaceRooms } from "@/components/chat/use-other-workspace-rooms";

interface UseChatTabUnreadPresenceResult {
  showUnreadDot: boolean;
  unreadRoomCount: number;
}

export function useChatTabUnreadPresence(): UseChatTabUnreadPresenceResult {
  const liveRooms = useLiveChatRooms() ?? [];
  const elsewhereRooms = useLiveOtherWorkspaceRooms();
  const unreadRoomCount = countChatRoomsWithUnreadAttention([
    ...liveRooms,
    ...elsewhereRooms,
  ]);
  return { showUnreadDot: unreadRoomCount > 0, unreadRoomCount };
}
