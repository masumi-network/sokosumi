import { getRedisClient } from "@/lib/redis";

import { COWORKER_STREAM_LOCK_TTL_SECONDS } from "./coworker-stream-lock";

export function coworkerPendingResponseRedisKey(
  internalConversationId: string,
): string {
  return `coworker:pending-response:${internalConversationId}`;
}

export async function setPendingResponseMirror(
  internalConversationId: string,
  responseId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.set(
      coworkerPendingResponseRedisKey(internalConversationId),
      responseId,
      "EX",
      COWORKER_STREAM_LOCK_TTL_SECONDS,
    );
  } catch (error) {
    console.error(
      "[coworker-pending-response-mirror] Failed to set pending mirror:",
      error,
    );
  }
}

export async function getPendingResponseMirror(
  internalConversationId: string,
): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const value = await redis.get(
      coworkerPendingResponseRedisKey(internalConversationId),
    );
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  } catch (error) {
    console.error(
      "[coworker-pending-response-mirror] Failed to read pending mirror:",
      error,
    );
    return null;
  }
}

export async function clearPendingResponseMirror(
  internalConversationId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(coworkerPendingResponseRedisKey(internalConversationId));
  } catch (error) {
    console.error(
      "[coworker-pending-response-mirror] Failed to clear pending mirror:",
      error,
    );
  }
}
