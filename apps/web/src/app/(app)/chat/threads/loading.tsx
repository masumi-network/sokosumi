import { ChatUnreadViewSkeleton } from "@/app/chat/components/chat-unread-view-skeleton";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ChatThreadsLoading() {
  return <ChatUnreadViewSkeleton />;
}
