import { getRedisClient } from "@/lib/redis";

import { COWORKER_STREAM_LOCK_TTL_SECONDS } from "./coworker-stream-lock";

export interface CoworkerPendingResponseScope {
  roomId: string;
  parentMessageId?: string | null;
}

export function coworkerPendingResponseRedisKey(
  scope: CoworkerPendingResponseScope,
): string {
  const parentMessageId = scope.parentMessageId?.trim();
  if (parentMessageId) {
    return `coworker:pending_resp:room:${scope.roomId}:thread:${parentMessageId}`;
  }
  return `coworker:pending_resp:room:${scope.roomId}`;
}

export async function setPendingResponseMirror(
  scope: CoworkerPendingResponseScope,
  responseId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.set(
      coworkerPendingResponseRedisKey(scope),
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
  scope: CoworkerPendingResponseScope,
): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const value = await redis.get(coworkerPendingResponseRedisKey(scope));
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
  scope: CoworkerPendingResponseScope,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(coworkerPendingResponseRedisKey(scope));
  } catch (error) {
    console.error(
      "[coworker-pending-response-mirror] Failed to clear pending mirror:",
      error,
    );
  }
}
