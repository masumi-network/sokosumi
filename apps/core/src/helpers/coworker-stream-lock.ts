import { v7 as uuidv7 } from "uuid";

import { getEnv } from "@/config/env";
import { getRedisClient } from "@/lib/redis";

export const COWORKER_STREAM_LOCK_TTL_SECONDS = 120;
export const COWORKER_STREAM_LOCK_HEARTBEAT_MS = 60_000;

/**
 * - acquired / held: normal single-flight outcomes
 * - unavailable: Redis never configured (local/dev) — callers may fail-open
 * - error: Redis client exists but acquire failed — callers should fail-closed
 */
export type AcquireStreamLockResult =
  | { status: "acquired"; ownerToken: string }
  | { status: "held" }
  | { status: "unavailable" }
  | { status: "error" };

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
    // No REDIS_URL / KV_URL — local and some agent envs. Fail-open is intentional.
    console.warn(
      "[coworker-stream-lock] Redis not configured; skipping coworker stream lock.",
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
    // Redis is configured but broken — fail-closed so multi-instance cannot
    // double-persist stream turns under a silent unlocked path.
    console.error(
      "[coworker-stream-lock] Redis error acquiring coworker stream lock:",
      error,
    );
    return { status: "error" };
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

export interface StartStreamLockHeartbeatOptions {
  /**
   * Optional side effect on each heartbeat tick (e.g. renew pending-response
   * mirror TTL). Failures inside the callback are the caller's concern.
   */
  onRenew?: () => void | Promise<void>;
}

export function startStreamLockHeartbeat(
  internalConversationId: string,
  ownerToken: string,
  options?: StartStreamLockHeartbeatOptions,
): () => void {
  const timer = setInterval(() => {
    void renewStreamLock(internalConversationId, ownerToken);
    if (options?.onRenew) {
      void options.onRenew();
    }
  }, COWORKER_STREAM_LOCK_HEARTBEAT_MS);

  return () => {
    clearInterval(timer);
  };
}
