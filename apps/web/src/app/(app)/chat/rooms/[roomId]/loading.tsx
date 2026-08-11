import { ChatRoomOpenSkeleton } from "@/app/chat/components/chat-room-open-skeleton";

/**
 * Instant / soft-nav shell for room open: header + message-list + composer bones.
 * Sync only (no cookies / connection / i18n). Full history streams in the page.
 */
export default function ChatRoomLoading() {
  return <ChatRoomOpenSkeleton />;
}
