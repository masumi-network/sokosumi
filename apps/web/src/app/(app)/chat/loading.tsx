import { ChatHomePageSkeleton } from "@/app/chat/components/chat-home-loading-view";

/** Sync shell only — no cookies/`connection()` (Instant Nav). */
export default function ChatHomeLoading() {
  return <ChatHomePageSkeleton />;
}
