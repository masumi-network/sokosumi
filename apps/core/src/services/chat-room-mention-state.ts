import prisma from "@/lib/db/prisma";

/** Hard ceiling for streamText only (not conversation create ≤25s). */
export const ROOM_COWORKER_TOTAL_MS = 240_000;

/** AI SDK stall budget after content has started; content chunks reset this. */
export const ROOM_COWORKER_CHUNK_MS = 90_000;

/**
 * No `firstChunkMs`: some coworkers think/tool for >90s with no content-bearing
 * SSE. Mentions are waitUntil jobs and must still terminate — `totalMs` is that
 * bound. `chunkMs` still kills a stall after output starts. Coworker 1:1 DMs
 * omit this timeout entirely (live SSE + function cap).
 */
export const ROOM_COWORKER_STREAM_TIMEOUT = {
  totalMs: ROOM_COWORKER_TOTAL_MS,
  chunkMs: ROOM_COWORKER_CHUNK_MS,
} as const;

/** Must exceed `ROOM_COWORKER_TOTAL_MS` so reclaim cannot steal an in-flight run. */
export const ROOM_SENT_STALE_MS = ROOM_COWORKER_TOTAL_MS + 30_000;

/**
 * After this long a mention is given up on rather than reclaimed again.
 *
 * Reclaim exists for a worker that died mid-dispatch, and it retries by
 * re-running the same work. When the cause is not transient the mention is
 * reclaimed for ever and the asker watches "Thinking…" indefinitely: the turn
 * that would have carried a deadline was never created, so nothing else can
 * end it. Past this age the reply says it failed.
 */
export const ROOM_MENTION_GIVE_UP_MS = 15 * 60_000;
const STALE_SENT_RECLAIM_LIMIT = 10;
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function markMentionFailed(
  mentionId: string,
  error: unknown,
): Promise<void> {
  // updateMany (not update) so a deleted row is a no-op instead of a throw, and
  // so a late failure can never overwrite an already committed response.
  await prisma.chatRoomMention
    .updateMany({
      where: { id: mentionId, status: { not: "responded" } },
      data: {
        status: "failed",
        error: errorMessage(error).slice(0, 500),
      },
    })
    .catch((updateError) => {
      console.error("Failed to mark room mention as failed:", updateError);
    });
}

/**
 * Ids of `sent` mentions abandoned after a killed `waitUntil` (or similar).
 * Callers schedule `dispatchChatRoomMention` for each so reclaim can run.
 */
export async function listStaleSentChatRoomMentionIds(
  roomId: string,
  options?: { limit?: number; now?: Date },
): Promise<string[]> {
  const now = options?.now ?? new Date();
  const staleBefore = new Date(now.getTime() - ROOM_SENT_STALE_MS);
  const rows = await prisma.chatRoomMention.findMany({
    where: {
      // `pending` too: a mention is written in one transaction and handed to
      // the dispatcher after it commits, so a process that dies in between
      // leaves a row nobody ever claimed. Scanning only `sent` left those
      // stranded for ever.
      status: { in: ["pending", "sent"] },
      updatedAt: { lt: staleBefore },
      message: { roomId },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: options?.limit ?? STALE_SENT_RECLAIM_LIMIT,
  });
  return rows.map((row) => row.id);
}

/**
 * Win the dispatch slot: `pending` → `sent`, or reclaim a stale `sent` row
 * left behind when the previous worker died after claiming.
 */
export async function claimMentionForDispatch(
  mentionId: string,
): Promise<boolean> {
  const pendingClaim = await prisma.chatRoomMention.updateMany({
    where: { id: mentionId, status: "pending" },
    data: {
      status: "sent",
      error: null,
    },
  });
  if (pendingClaim.count > 0) {
    return true;
  }

  const staleBefore = new Date(Date.now() - ROOM_SENT_STALE_MS);
  const staleClaim = await prisma.chatRoomMention.updateMany({
    where: {
      id: mentionId,
      status: "sent",
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "sent",
      error: null,
    },
  });
  return staleClaim.count > 0;
}
