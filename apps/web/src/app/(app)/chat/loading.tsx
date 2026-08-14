import { ChatChatsPageSkeleton } from "@/app/chat/components/chat-chats-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ChatChatsLoading() {
  return <ChatChatsPageSkeleton />;
}
