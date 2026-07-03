import { v7 as uuidv7 } from "uuid";

import { getEnv } from "@/config/env";
import { getRedisClient } from "@/lib/redis";

export const COWORKER_STREAM_LOCK_TTL_SECONDS = 120;
export const COWORKER_STREAM_LOCK_HEARTBEAT_MS = 60_000;

export type AcquireStreamLockResult =
  | { status: "acquired"; ownerToken: string }
  | { status: "held" }
  | { status: "unavailable" };

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
  return `coworker:stream_lock:${internalConversationId}`;
}

function createStreamLockOwnerToken(): string {
  return `${getEnv().INSTANCE_ID}:${uuidv7()}`;
}

export async function acquireStreamLock(
  internalConversationId: string,
): Promise<AcquireStreamLockResult> {
  const redis = getRedisClient();
  if (!redis) {
    console.warn(
      "[coworker-stream-lock] Redis unavailable; skipping coworker stream lock.",
    );
    return { status: "unavailable" };
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
    return result === "OK"
      ? { status: "acquired", ownerToken }
      : { status: "held" };
  } catch (error) {
    console.warn(
      "[coworker-stream-lock] Redis error; skipping coworker stream lock:",
      error,
    );
    return { status: "unavailable" };
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
  const timer = setInterval(() => {
    void renewStreamLock(internalConversationId, ownerToken);
  }, COWORKER_STREAM_LOCK_HEARTBEAT_MS);

  return () => {
    clearInterval(timer);
  };
}
