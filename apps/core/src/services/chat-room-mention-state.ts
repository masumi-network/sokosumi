import type { Prisma } from "@sokosumi/database";
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
 *
 * Returns the claim's stamp, written as the mention's `updatedAt` in the
 * claiming statement itself, so it identifies this claim without a second
 * read (`failSokoBotReplyIfOwned`); `reclaimed` when it took over a stale
 * `sent` row rather than a `pending` one.
 */
export async function claimMentionForDispatch(
  mentionId: string,
): Promise<{ stamp: Date; reclaimed: boolean } | null> {
  const stamp = new Date();
  const pendingClaim = await prisma.chatRoomMention.updateMany({
    where: { id: mentionId, status: "pending" },
    data: {
      status: "sent",
      error: null,
      updatedAt: stamp,
    },
  });
  if (pendingClaim.count > 0) {
    return { stamp, reclaimed: false };
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
      updatedAt: stamp,
    },
  });
  return staleClaim.count > 0 ? { stamp, reclaimed: true } : null;
}

/**
 * Explicit Retry only, inside the transaction that resets the mention. A
 * failed or cancelled turn whose outcome is already written lets go of the
 * mention (one turn per mention), so the dispatch starts a new turn under
 * `chat:<mention>:retry:<that turn>` instead of getting this one back. A turn
 * still running, completed, or with a delivery still to land keeps the link:
 * the dispatch then resumes it rather than running the request again. The
 * turn keeps its room (`destinationRoomId`) and reply (`chatResponseMessageId`).
 */
export async function releaseFailedTurnForRetry(
  tx: Prisma.TransactionClient,
  mentionId: string,
): Promise<void> {
  const turn = await tx.sokoBotTurn.findUnique({
    where: { chatMentionId: mentionId },
    select: {
      id: true,
      status: true,
      deliveries: {
        where: { status: { in: ["PENDING", "PERSISTED"] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (
    !turn ||
    (turn.status !== "FAILED" && turn.status !== "CANCELLED") ||
    turn.deliveries.length > 0
  ) {
    return;
  }
  await tx.sokoBotTurn.updateMany({
    where: { id: turn.id, chatMentionId: mentionId, status: turn.status },
    data: { chatMentionId: null },
  });
}

/**
 * The time a Soko Bot reply's attempt started, carried in its metadata by
 * every write to that reply. Web orders full message events by it (newer
 * attempt, then settled over "Thinking…"), and dispatch measures its give-up
 * budget from it, so an explicit Retry starts a fresh budget.
 */
export function readSokoBotAttemptAt(metadata: unknown): number | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const sokoBot = (metadata as { soko_bot?: unknown }).soko_bot;
  if (!sokoBot || typeof sokoBot !== "object") return undefined;
  const at = (sokoBot as { attempt_at?: unknown }).attempt_at;
  return typeof at === "number" ? at : undefined;
}

/**
 * Fails a Soko Bot mention, and its reply, only when the failing worker may.
 *
 * - A turn holds the mention: only that turn's own failure may be written
 *   (FAILED or CANCELLED). A worker's local error (a read, a restore, a
 *   setup step) never fails a running or COMPLETED turn: the running one ends
 *   by its own deadline and delivery, and the completed one's answer would
 *   be lost. The mention stays `sent` for stale reclaim to settle.
 * - No turn holds it: the worker owns it only while the mention's
 *   `updatedAt` is still `stamp`, the value it observed (before claiming) or
 *   wrote (its claim, kept while opening the reply). Any other claim, stale
 *   reclaim or Retry rewrites it.
 *
 * All of this runs under the mention's row lock, the lock Retry's reset and
 * every claim take, so no check-then-write gap remains.
 *
 * The reply: a live empty one becomes the failed card. A missing one (never
 * opened, or hard-deleted) is created as the failed card, so Retry has a card
 * to live on. A soft-deleted one was withdrawn on purpose and stays deleted.
 * Returns the reply to publish and how, or null when nothing was written.
 */
export async function failSokoBotReplyIfOwned(params: {
  mentionId: string;
  stamp: Date | null;
  error: unknown;
}): Promise<{ replyId: string; eventType: "create" | "update" } | null> {
  const { mentionId } = params;
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ updatedAt: Date }[]>`
      SELECT "updatedAt" FROM "chat_room_mention"
      WHERE "id" = ${mentionId}::uuid FOR UPDATE`;
    if (!locked) return null;
    const holder = await tx.sokoBotTurn.findUnique({
      where: { chatMentionId: mentionId },
      select: { id: true, status: true },
    });
    const owned = holder
      ? holder.status === "FAILED" || holder.status === "CANCELLED"
      : params.stamp?.getTime() === locked.updatedAt.getTime();
    if (!owned) return null;
    const mention = await tx.chatRoomMention.findUniqueOrThrow({
      where: { id: mentionId },
      select: {
        status: true,
        sokoBotId: true,
        messageId: true,
        responseMessage: { select: { id: true, metadata: true } },
        message: { select: { roomId: true, parentMessageId: true } },
      },
    });
    if (mention.status === "responded") return null;
    await tx.chatRoomMention.update({
      where: { id: mentionId },
      data: {
        status: "failed",
        error: errorMessage(params.error).slice(0, 500),
      },
    });
    const metadata = {
      in_reply_to_message_id: mention.messageId,
      mention_id: mentionId,
      mention_failed: true,
      soko_bot: {
        ...(holder ? { turn_id: holder.id } : {}),
        attempt_at:
          readSokoBotAttemptAt(mention.responseMessage?.metadata) ??
          params.stamp?.getTime() ??
          Date.now(),
      },
    };
    const reply = mention.responseMessage;
    if (reply) {
      // Same guards as `failMentionThoughtPlaceholder`: never erase final
      // content, never touch a withdrawn (soft-deleted) reply.
      const shell = await tx.chatRoomMessage.updateMany({
        where: { id: reply.id, content: "", deletedAt: null },
        data: { metadata },
      });
      return shell.count > 0
        ? { replyId: reply.id, eventType: "update" }
        : null;
    }
    const created = await tx.chatRoomMessage.create({
      data: {
        roomId: mention.message.roomId,
        parentMessageId: mention.message.parentMessageId,
        senderSokoBotId: mention.sokoBotId,
        content: "",
        metadata,
      },
    });
    await tx.chatRoomMention.update({
      where: { id: mentionId },
      data: { responseMessageId: created.id },
    });
    await tx.chatRoom.update({
      where: { id: mention.message.roomId },
      data: { updatedAt: new Date() },
    });
    return { replyId: created.id, eventType: "create" };
  });
}
