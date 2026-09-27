import { getRedisClient } from "@/lib/redis";

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
    console.error("[coworker-late-responses] Failed to track response:", error);
  }
}

export async function untrackLateCoworkerResponse(
  responseId: string,
): Promise<void> {
  try {
    await getRedisClient()?.hdel(LATE_RESPONSES_REDIS_KEY, responseId);
  } catch (error) {
    console.error(
      "[coworker-late-responses] Failed to untrack response:",
      error,
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
  return Object.values(entries).flatMap((value) => {
    try {
      return [JSON.parse(value) as LateCoworkerResponse];
    } catch {
      return [];
    }
  });
}
