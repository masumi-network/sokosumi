import { v7 as uuidv7 } from "uuid";

import { getEnv } from "@/config/env";
import { getRedisClient } from "@/lib/redis";

export const COWORKER_STREAM_LOCK_TTL_SECONDS = 120;

const RENEW_STREAM_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_STREAM_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export function coworkerStreamLockRedisKey(
  internalConversationId: string,
): string {
  return `coworker:stream-lock:${internalConversationId}`;
}

function createStreamLockOwnerToken(): string {
  return `${getEnv().INSTANCE_ID}:${uuidv7()}`;
}

export async function acquireStreamLock(
  internalConversationId: string,
): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  const key = coworkerStreamLockRedisKey(internalConversationId);
  const ownerToken = createStreamLockOwnerToken();

  try {
    const result = await redis.set(
      key,
      ownerToken,
      "EX",
      COWORKER_STREAM_LOCK_TTL_SECONDS,
      "NX",
    );
    return result === "OK" ? ownerToken : null;
  } catch (error) {
    console.error(
      "[coworker-stream-lock] Failed to acquire stream lock:",
      error,
    );
    return null;
  }
}

export async function renewStreamLock(
  internalConversationId: string,
  ownerToken: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return false;
  }

  const key = coworkerStreamLockRedisKey(internalConversationId);

  try {
    const result = await redis.eval(
      RENEW_STREAM_LOCK_SCRIPT,
      1,
      key,
      ownerToken,
      String(COWORKER_STREAM_LOCK_TTL_SECONDS),
    );
    return result === 1;
  } catch (error) {
    console.error("[coworker-stream-lock] Failed to renew stream lock:", error);
    return false;
  }
}

export async function releaseStreamLock(
  internalConversationId: string,
  ownerToken: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return false;
  }

  const key = coworkerStreamLockRedisKey(internalConversationId);

  try {
    const result = await redis.eval(
      RELEASE_STREAM_LOCK_SCRIPT,
      1,
      key,
      ownerToken,
    );
    return result === 1;
  } catch (error) {
    console.error(
      "[coworker-stream-lock] Failed to release stream lock:",
      error,
    );
    return false;
  }
}

export function startStreamLockHeartbeat(
  internalConversationId: string,
  ownerToken: string,
): () => void {
  const intervalMs = Math.max(
    5_000,
    Math.floor((COWORKER_STREAM_LOCK_TTL_SECONDS * 1000) / 3),
  );

  const timer = setInterval(() => {
    void renewStreamLock(internalConversationId, ownerToken);
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
