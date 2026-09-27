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

export interface LateResponsesSyncResult {
  delivered: number;
  dropped: number;
  waiting: number;
}

async function deliver(
  entry: LateCoworkerResponse,
  fetchFn: typeof fetch | undefined,
): Promise<"delivered" | "dropped" | "waiting"> {
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
  return "dropped";
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
  for (const entry of await listLateCoworkerResponses()) {
    if (!options.shouldContinue()) {
      break;
    }
    const age = now() - entry.startedAtMs;
    if (age < LATE_RESPONSE_GRACE_MS) {
      result.waiting += 1;
      continue;
    }
    let outcome: "delivered" | "dropped" | "waiting";
    try {
      outcome =
        age > LATE_RESPONSE_MAX_AGE_MS
          ? "dropped"
          : await deliver(entry, options.fetchFn);
    } catch (error) {
      console.error(
        `[sync/coworker-late-responses] Failed to deliver ${entry.responseId}:`,
        error,
      );
      outcome = "waiting";
    }
    if (outcome !== "waiting") {
      await untrackLateCoworkerResponse(entry.responseId);
    }
    result[outcome] += 1;
  }
  return result;
}
