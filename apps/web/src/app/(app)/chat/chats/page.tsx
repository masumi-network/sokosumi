import { redirect } from "next/navigation";

/**
 * Legacy mobile list URL. Chat root (`/chat`) is the Chat tab and list now.
 */
export default function ChatChatsPage() {
  redirect("/chat");
}
