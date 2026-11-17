import { recordCoreError } from "@/lib/evlog";
import { getRedisClient } from "@/lib/redis";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

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
    recordPendingMirrorFailure(
      "set",
      "Writing the pending response mirror in Redis failed",
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
    recordPendingMirrorFailure(
      "read",
      "Reading the pending response mirror in Redis failed",
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
    recordPendingMirrorFailure(
      "clear",
      "Deleting the pending response mirror in Redis failed",
      error,
    );
  }
}

/**
 * Refresh TTL on an existing pending mirror key. No-op when Redis is absent
 * or the key was already cleared/expired — does not recreate the key.
 */
export async function renewPendingResponseMirror(
  scope: CoworkerPendingResponseScope,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.expire(
      coworkerPendingResponseRedisKey(scope),
      COWORKER_STREAM_LOCK_TTL_SECONDS,
    );
  } catch (error) {
    recordPendingMirrorFailure(
      "renew",
      "Refreshing the expiry of the pending response mirror in Redis failed",
      error,
    );
  }
}

/** ioredis quotes the server's or a proxy's reply: content-free fields only. */
function recordPendingMirrorFailure(
  action: "set" | "read" | "clear" | "renew",
  why: string,
  error: unknown,
): void {
  recordCoreError(
    { operation: "coworker_pending_response_mirror" },
    {
      message: "A coworker's pending response mirror could not be updated",
      why,
      fix: "A reconnecting client may not find the running reply. Check Redis; failure has its name and code.",
    },
    { mirror: { action }, failure: messageSafeErrorFields(error) },
  );
}
