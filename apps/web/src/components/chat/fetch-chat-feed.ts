import type { ChatFeed } from "@sokosumi/core-client";
import { getChatsFeedResponseTransformer } from "@sokosumi/core-client/transformers";
import { fetchBackgroundJson } from "@/components/chat/fetch-background-json";

const FEED_REQUEST_TIMEOUT_MS = 20_000;

/**
 * One page of the reader's Feed, through the background route, so the read
 * never queues behind a chat mutation. Throws on any failure, for the query
 * to show and retry.
 */
export async function fetchChatFeed(options: {
  cursor?: string;
  limit?: number;
}): Promise<ChatFeed> {
  const params = new URLSearchParams();
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  const query = params.size > 0 ? `?${params}` : "";
  const data = await fetchBackgroundJson(
    `/api/chat/feed${query}`,
    FEED_REQUEST_TIMEOUT_MS,
  );
  if (data == null) {
    throw new Error("Feed unavailable");
  }
  return (await getChatsFeedResponseTransformer(data)).data;
}
