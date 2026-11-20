import { recordCoreError } from "@/lib/evlog";
import { getRedisClient } from "@/lib/redis";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

/**
 * Coworker responses still running when their stream request may end. The
 * stream function stops after `maxDuration`; the late-responses sync delivers
 * any reply that finishes after that. Entries live until delivered or dropped.
 */
const LATE_RESPONSES_REDIS_KEY = "coworker:late_responses";

export interface LateCoworkerResponse {
  responseId: string;
  roomId: string;
  parentMessageId: string | null;
  coworkerId: string;
  userId: string;
  organizationId: string | null;
  startedAtMs: number;
}

export async function trackLateCoworkerResponse(
  entry: LateCoworkerResponse,
): Promise<void> {
  try {
    await getRedisClient()?.hset(
      LATE_RESPONSES_REDIS_KEY,
      entry.responseId,
      JSON.stringify(entry),
    );
  } catch (error) {
    // ioredis quotes the server's or a proxy's reply: content-free fields only.
    recordCoreError(
      {
        operation: "coworker_late_response_track",
        responseId: entry.responseId,
      },
      {
        message:
          "A coworker response that may outlive its stream was not tracked",
        why: "Writing the late-response entry to Redis failed",
        fix: "If the stream ends before the reply, the reply is not delivered. Check Redis; failure has its name and code.",
      },
      { failure: messageSafeErrorFields(error) },
    );
  }
}

export async function untrackLateCoworkerResponse(
  responseId: string,
): Promise<void> {
  try {
    await getRedisClient()?.hdel(LATE_RESPONSES_REDIS_KEY, responseId);
  } catch (error) {
    recordCoreError(
      { operation: "coworker_late_response_untrack", responseId },
      {
        message:
          "A delivered coworker response was not removed from the late responses",
        why: "Deleting the late-response entry from Redis failed",
        fix: "The late-responses sync may try to deliver it again. Check Redis; failure has its name and code.",
      },
      { failure: messageSafeErrorFields(error) },
    );
  }
}

export async function listLateCoworkerResponses(): Promise<
  LateCoworkerResponse[]
> {
  const redis = getRedisClient();
  if (!redis) {
    return [];
  }
  const entries = await redis.hgetall(LATE_RESPONSES_REDIS_KEY);
  const valid: LateCoworkerResponse[] = [];
  const unreadable: string[] = [];
  for (const [responseId, value] of Object.entries(entries)) {
    try {
      valid.push(JSON.parse(value) as LateCoworkerResponse);
    } catch {
      unreadable.push(responseId);
    }
  }
  if (unreadable.length > 0) {
    await redis.hdel(LATE_RESPONSES_REDIS_KEY, ...unreadable);
  }
  return valid;
}
