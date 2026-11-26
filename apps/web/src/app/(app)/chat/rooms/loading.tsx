import { ChatChatsPageSkeletonHost } from "@/app/chat/components/chat-chats-page-skeleton-host";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ChatChatsLoading() {
  return <ChatChatsPageSkeletonHost />;
}
