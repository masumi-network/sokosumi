import { fetchBackgroundJson } from "@/components/chat/fetch-background-json";
import { getChatsThreadsUnreadResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";
import type { ChatUnreadThreadsPage } from "@/lib/services/chat-room.service";

const UNREAD_THREADS_REQUEST_TIMEOUT_MS = 20_000;

/**
 * One page of the reader's unread Threads, through the background route, so a
 * read the sidebar poll sets off never queues behind a chat mutation. Throws
 * on any failure, for the query to show and retry.
 */
export async function fetchChatUnreadThreads(
  cursor: string | undefined,
): Promise<ChatUnreadThreadsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const data = await fetchBackgroundJson(
    `/api/chat/threads/unread${query}`,
    UNREAD_THREADS_REQUEST_TIMEOUT_MS,
  );
  if (data == null) {
    throw new Error("Unread threads unavailable");
  }
  const page = await getChatsThreadsUnreadResponseTransformer(data);
  return {
    threads: page.data,
    nextCursor: page.meta.pagination.nextCursor,
  };
}
