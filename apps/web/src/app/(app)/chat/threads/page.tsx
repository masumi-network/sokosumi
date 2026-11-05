import { redirect } from "next/navigation";

import { CHAT_CATCH_UP_PATH } from "@/app/chat/utils/chat-route-base";

/** Threads is a tab of Catch up now; old links land there. */
export default function ChatThreadsPage() {
  redirect(`${CHAT_CATCH_UP_PATH}/threads`);
}
