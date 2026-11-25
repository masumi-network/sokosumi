import { ChatUnreadViewSkeleton } from "@/app/chat/components/chat-unread-view-skeleton";

/** Sync shell only: no cookies or `connection()` (Instant Nav). */
export default function ChatFeedLoading() {
  return <ChatUnreadViewSkeleton />;
}
