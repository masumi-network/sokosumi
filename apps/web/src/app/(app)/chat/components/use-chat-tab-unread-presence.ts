"use client";

import { countChatRoomsWithUnreadAttention } from "@/components/chat/chat-unread-document-title";
import { useLiveElsewhereRooms } from "@/components/chat/use-elsewhere-rooms";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";

interface UseChatTabUnreadPresenceResult {
  showUnreadDot: boolean;
  unreadRoomCount: number;
}

export function useChatTabUnreadPresence(): UseChatTabUnreadPresenceResult {
  const liveRooms = useLiveChatRooms() ?? [];
  const elsewhereRooms = useLiveElsewhereRooms();
  const unreadRoomCount = countChatRoomsWithUnreadAttention([
    ...liveRooms,
    ...elsewhereRooms,
  ]);
  return { showUnreadDot: unreadRoomCount > 0, unreadRoomCount };
}
