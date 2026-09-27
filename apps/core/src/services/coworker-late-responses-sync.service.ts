import {
  type LateCoworkerResponse,
  listLateCoworkerResponses,
  untrackLateCoworkerResponse,
} from "@/helpers/coworker-late-responses";
import { clearPendingResponseMirror } from "@/helpers/coworker-pending-response-mirror";
import { retrieveCoworkerResponse } from "@/helpers/coworker-response-poll";
import { persistAssistantToChatRoom } from "@/helpers/persist-assistant-to-chat-room";
import prisma from "@/lib/db/prisma";

/** Leave a response to its live stream until that request has certainly ended (maxDuration 300 s). */
export const LATE_RESPONSE_GRACE_MS = 330_000;
/** Coworker turns are capped at an hour; give up on a response after two. */
export const LATE_RESPONSE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** Bounds one run; the rest wait for the next minute, oldest first. */
export const LATE_RESPONSES_PER_RUN = 25;
/** Posted in the chat when a reply is given up, so the user is not left waiting. */
export const LATE_RESPONSE_MISSING_TEXT =
  "No reply arrived for this message. Please send it again.";

type Outcome = "delivered" | "dropped" | "missing" | "waiting";

export interface LateResponsesSyncResult {
  delivered: number;
  dropped: number;
  waiting: number;
}

async function deliver(
  entry: LateCoworkerResponse,
  fetchFn: typeof fetch | undefined,
): Promise<Outcome> {
  const coworker = await prisma.coworker.findUnique({
    where: { id: entry.coworkerId },
    select: { slug: true, baseURL: true },
  });
  const baseURL = coworker?.baseURL?.trim();
  if (!coworker || !baseURL) {
    return "dropped";
  }
  const { result, text } = await retrieveCoworkerResponse({
    responsesApiBaseUrl: baseURL,
    responseId: entry.responseId,
    userId: entry.userId,
    organizationId: entry.organizationId,
    coworkerSlug: coworker.slug,
    fetchFn,
  });
  if (result.status === "error" && result.httpStatus === 404) {
    return "missing";
  }
  if (result.status === "in_progress" || result.status === "error") {
    return "waiting";
  }
  if (result.status === "completed" && text) {
    // Deduplicated by response id, so a reply the stream already saved is not posted twice.
    await persistAssistantToChatRoom({
      roomId: entry.roomId,
      senderCoworkerId: entry.coworkerId,
      contentText: text,
      responsesApiResponseId: entry.responseId,
      parentMessageId: entry.parentMessageId,
    });
    await clearPendingResponseMirror({
      roomId: entry.roomId,
      parentMessageId: entry.parentMessageId,
    });
    return "delivered";
  }
  return "missing";
}

// Same response id as the reply: if that reply was saved after all, no note is added.
async function postMissingNote(entry: LateCoworkerResponse): Promise<void> {
  await persistAssistantToChatRoom({
    roomId: entry.roomId,
    senderCoworkerId: entry.coworkerId,
    contentText: LATE_RESPONSE_MISSING_TEXT,
    responsesApiResponseId: entry.responseId,
    parentMessageId: entry.parentMessageId,
  });
  await clearPendingResponseMirror({
    roomId: entry.roomId,
    parentMessageId: entry.parentMessageId,
  });
}

export async function syncLateCoworkerResponses(options: {
  shouldContinue: () => boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
}): Promise<LateResponsesSyncResult> {
  const now = options.now ?? Date.now;
  const result: LateResponsesSyncResult = {
    delivered: 0,
    dropped: 0,
    waiting: 0,
  };
  const due: LateCoworkerResponse[] = [];
  for (const entry of await listLateCoworkerResponses()) {
    if (now() - entry.startedAtMs < LATE_RESPONSE_GRACE_MS) {
      result.waiting += 1;
    } else {
      due.push(entry);
    }
  }
  due.sort((a, b) => a.startedAtMs - b.startedAtMs);
  for (const [index, entry] of due.entries()) {
    if (index >= LATE_RESPONSES_PER_RUN || !options.shouldContinue()) {
      result.waiting += due.length - index;
      break;
    }
    const expired = now() - entry.startedAtMs > LATE_RESPONSE_MAX_AGE_MS;
    let outcome: Outcome;
    try {
      outcome = expired ? "missing" : await deliver(entry, options.fetchFn);
      if (outcome === "missing") {
        await postMissingNote(entry);
      }
    } catch (error) {
      console.error(
        `[sync/coworker-late-responses] Failed to deliver ${entry.responseId}:`,
        error,
      );
      // Past the age limit an entry never stays, even when the note cannot be saved.
      outcome = expired ? "dropped" : "waiting";
    }
    if (outcome !== "waiting") {
      await untrackLateCoworkerResponse(entry.responseId);
    }
    result[outcome === "missing" ? "dropped" : outcome] += 1;
  }
  return result;
}
