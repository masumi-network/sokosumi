import type {
  ChatResultPreview,
  ChatRoomMessageResults,
} from "@sokosumi/core-client";
import { getChatRoomMessageResultsBatchResponseTransformer } from "@sokosumi/core-client/transformers";

/** Core's batch cap (`/v1/chats/rooms/{id}/message-results`). */
const MESSAGE_RESULTS_BATCH_LIMIT = 50;

type ResultsByMessage = Map<string, ChatResultPreview[]>;

interface QueuedBatch {
  ids: Set<string>;
  results: Promise<ResultsByMessage>;
}

const queued = new Map<string, QueuedBatch>();
function byMessage(entries: ChatRoomMessageResults[]): ResultsByMessage {
  return new Map(entries.map((entry) => [entry.messageId, entry.results]));
}

async function fetchBatch(
  roomId: string,
  messageIds: string[],
): Promise<ResultsByMessage> {
  const response = await fetch(
    `/api/chat/${encodeURIComponent(roomId)}/message-results?messageIds=${messageIds.map(encodeURIComponent).join(",")}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok) throw new Error("Results unavailable");
  const page = await getChatRoomMessageResultsBatchResponseTransformer(
    await response.json(),
  );
  return byMessage(page.data);
}

/** Rows that mount in the same task share one read and one read-budget token. */
function enqueue(roomId: string, messageId: string) {
  let batch = queued.get(roomId);
  if (!batch || batch.ids.size >= MESSAGE_RESULTS_BATCH_LIMIT) {
    const ids = new Set<string>();
    const results = new Promise((resolve) => setTimeout(resolve, 0)).then(
      () => {
        if (queued.get(roomId)?.ids === ids) queued.delete(roomId);
        return fetchBatch(roomId, [...ids]);
      },
    );
    batch = { ids, results };
    queued.set(roomId, batch);
  }
  batch.ids.add(messageId);
  return batch.results;
}

function pick(results: ResultsByMessage, messageId: string) {
  // An omitted id is missing or deleted. An empty list is a live message.
  if (!results.has(messageId)) throw new Error("Results unavailable");
  return results.get(messageId) ?? [];
}

export async function loadRoomMessageResults(
  roomId: string,
  messageId: string,
): Promise<ChatResultPreview[]> {
  return pick(await enqueue(roomId, messageId), messageId);
}
