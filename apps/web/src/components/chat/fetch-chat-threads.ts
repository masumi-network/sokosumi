import { fetchBackgroundJson } from "@/components/chat/fetch-background-json";
import {
  getChatsThreadsEarlierResponseTransformer,
  getChatsThreadsUnreadResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";
import type {
  ChatEarlierThreadsPage,
  ChatUnreadThreadsPage,
} from "@/lib/services/chat-room.service";

const THREADS_REQUEST_TIMEOUT_MS = 20_000;

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
    THREADS_REQUEST_TIMEOUT_MS,
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

/** One page of the reader's read Threads (the Earlier group), likewise. */
export async function fetchChatEarlierThreads(
  cursor: string | undefined,
): Promise<ChatEarlierThreadsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const data = await fetchBackgroundJson(
    `/api/chat/threads/earlier${query}`,
    THREADS_REQUEST_TIMEOUT_MS,
  );
  if (data == null) {
    throw new Error("Earlier threads unavailable");
  }
  const page = await getChatsThreadsEarlierResponseTransformer(data);
  return {
    threads: page.data,
    nextCursor: page.meta.pagination.nextCursor,
  };
}
