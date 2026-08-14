import { redirect } from "next/navigation";

import {
  CHAT_CHATS_LIST_PATH,
  type NextSearchParamsRecord,
  pathWithSearch,
  toURLSearchParamsFromRecord,
} from "@/app/chat/utils/chat-route-base";

interface ChatChatsLegacyPageProps {
  searchParams: Promise<NextSearchParamsRecord>;
}

/**
 * Legacy `/chat/chats` → always `/chat` (query preserved). Not breakpoint-
 * specific; desktop bare `/chat` then client-redirects to Welcome.
 */
export default async function ChatChatsLegacyPage({
  searchParams,
}: ChatChatsLegacyPageProps) {
  const params = await searchParams;
  redirect(
    pathWithSearch(CHAT_CHATS_LIST_PATH, toURLSearchParamsFromRecord(params)),
  );
}
