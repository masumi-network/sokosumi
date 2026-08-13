import { redirect } from "next/navigation";

/** Legacy list URL — bounce to chat root before a list-shaped Instant shell. */
export default function ChatChatsLoading() {
  redirect("/chat");
}
