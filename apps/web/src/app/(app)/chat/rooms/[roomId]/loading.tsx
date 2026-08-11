import { ChatRoomOpenSkeleton } from "@/app/chat/components/chat-room-open-skeleton";

/**
 * Instant / soft-nav shell for room open: message-list skeleton only.
 * Real header + composer paint with the progressive shell (SOK-778).
 * Sync only (no cookies / connection / i18n).
 */
export default function ChatRoomLoading() {
  return <ChatRoomOpenSkeleton />;
}
