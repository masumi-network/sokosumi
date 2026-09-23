"use client";

import { countChatRoomsWithUnreadAttention } from "@/components/chat/chat-unread-document-title";
import { useLiveChatRooms } from "@/components/chat/use-live-chat-rooms";

interface UseChatTabUnreadPresenceResult {
  showUnreadDot: boolean;
  unreadRoomCount: number;
}

export function useChatTabUnreadPresence(): UseChatTabUnreadPresenceResult {
  const unreadRoomCount = countChatRoomsWithUnreadAttention(useLiveChatRooms());
  return { showUnreadDot: unreadRoomCount > 0, unreadRoomCount };
}
