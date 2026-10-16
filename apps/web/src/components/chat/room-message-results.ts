import type {
  ChatResultPreview,
  ChatRoomMessageResults,
} from "@sokosumi/core-client";
import { getChatRoomMessageResultsBatchResponseTransformer } from "@sokosumi/core-client/transformers";

/** Core's batch cap (`/v1/chats/rooms/{id}/message-results`). */
const MESSAGE_RESULTS_BATCH_LIMIT = 50;
/** A server-started read only stands in for the rows of the open it served. */
const PRIMED_RESULTS_TTL_MS = 60_000;

type ResultsByMessage = Map<string, ChatResultPreview[]>;

interface QueuedBatch {
  ids: Set<string>;
  results: Promise<ResultsByMessage>;
}

const queued = new Map<string, QueuedBatch>();
const primed = new Map<
  string,
  { at: number; results: Promise<ResultsByMessage | null> }
>();

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
  const found = results.get(messageId);
  // A message the read omits is missing or deleted.
  if (!found) throw new Error("Results unavailable");
  return found;
}

/**
 * Hand the results a room page read on the server to the rows it renders.
 * Each message takes its entry once; a later mount reads fresh.
 */
export function primeRoomMessageResults(
  viewerId: string,
  roomId: string,
  results: Promise<ChatRoomMessageResults[] | null>,
) {
  primed.set(`${viewerId}:${roomId}`, {
    at: Date.now(),
    results: results.then(
      (entries) => (entries ? byMessage(entries) : null),
      () => null,
    ),
  });
}

async function takePrimed(
  viewerId: string,
  roomId: string,
  messageId: string,
): Promise<ChatResultPreview[] | null> {
  const key = `${viewerId}:${roomId}`;
  const entry = primed.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > PRIMED_RESULTS_TTL_MS) {
    primed.delete(key);
    return null;
  }
  const results = await entry.results;
  const found = results?.get(messageId);
  results?.delete(messageId);
  return found ?? null;
}

export async function loadRoomMessageResults(
  viewerId: string,
  roomId: string,
  messageId: string,
): Promise<ChatResultPreview[]> {
  const ready = await takePrimed(viewerId, roomId, messageId);
  if (ready) return ready;
  return pick(await enqueue(roomId, messageId), messageId);
}
