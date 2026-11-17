import { v7 as uuidv7 } from "uuid";
import { getEnv } from "@/config/env";
import {
  recordCoreError,
  recordCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { getRedisClient } from "@/lib/redis";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

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
    recordCoreWarning(
      { operation: "coworker_stream_lock" },
      {
        message: "A coworker stream ran without its lock",
        why: "Redis is not configured, so the stream lock is skipped",
        fix: "Set REDIS_URL or KV_URL where more than one instance serves streams.",
      },
      { conversationId: internalConversationId },
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
    recordStreamLockFailure(
      "acquire",
      internalConversationId,
      "Redis failed the lock request",
      "The stream is refused so no two instances persist the same turn. Check Redis; failure has its name and code.",
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
    recordStreamLockFailure(
      "renew",
      internalConversationId,
      "Redis failed the lock renewal",
      "The lock may expire while the stream still runs. Check Redis; failure has its name and code.",
      error,
    );
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
    recordStreamLockFailure(
      "release",
      internalConversationId,
      "Redis failed the lock release",
      "The conversation stays locked until the lock expires. Check Redis; failure has its name and code.",
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
    void runAsBackgroundWork(async () => {
      const renewed = await renewStreamLock(internalConversationId, ownerToken);
      if (renewed && options?.onRenew) {
        await options.onRenew();
      }
    });
  }, COWORKER_STREAM_LOCK_HEARTBEAT_MS);

  return () => {
    clearInterval(timer);
  };
}

/** ioredis quotes the server's or a proxy's reply: content-free fields only. */
function recordStreamLockFailure(
  action: "acquire" | "renew" | "release",
  conversationId: string,
  why: string,
  fix: string,
  error: unknown,
): void {
  recordCoreError(
    { operation: "coworker_stream_lock" },
    {
      message: `Could not ${action} a coworker stream lock`,
      why,
      fix,
    },
    { conversationId, failure: messageSafeErrorFields(error) },
  );
}
