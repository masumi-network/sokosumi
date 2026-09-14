import { LIMITS } from "@/config/constants";
import { tooManyRequests } from "@/helpers/error";
import { tryUseLogger } from "@/lib/evlog";
import { getRedisClient } from "@/lib/redis";

/** Idle budget keys expire; full refill takes BURST / REFILL seconds. */
const BUDGET_TTL_SECONDS = 300;

const CONSUME_BUDGET_SCRIPT = `
local tokens = tonumber(redis.call("hget", KEYS[1], "tokens"))
local updated_ms = tonumber(redis.call("hget", KEYS[1], "updated_ms"))
local capacity = tonumber(ARGV[1])
local refill_per_second = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

if tokens == nil then
  tokens = capacity
  updated_ms = now_ms
end

local elapsed_ms = math.max(0, now_ms - updated_ms)
tokens = math.min(capacity, tokens + elapsed_ms / 1000 * refill_per_second)

local allowed = 0
local retry_after_seconds = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after_seconds = math.ceil((1 - tokens) / refill_per_second)
end

redis.call("hset", KEYS[1], "tokens", tokens, "updated_ms", now_ms)
redis.call("expire", KEYS[1], ARGV[4])
return {allowed, retry_after_seconds}
`;

export function chatMessageReadBudgetRedisKey(userId: string): string {
  return `chat:message-read-budget:${userId}`;
}

/**
 * Shared per-user budget for chat history reads across rooms and credentials
 * (SOK-1060). Keyed by user id only, so extra sessions or API keys cannot
 * multiply one user's budget. Throws 429 with a retry delay when exhausted.
 *
 * Fail-open without Redis (local/dev) and on Redis errors: the budget is a
 * protective throttle, not an auth gate, so reads stay available.
 */
export async function assertChatMessageReadBudget(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  let result: unknown;
  try {
    result = await redis.eval(
      CONSUME_BUDGET_SCRIPT,
      1,
      chatMessageReadBudgetRedisKey(userId),
      LIMITS.CHAT_MESSAGE_READ_BURST,
      LIMITS.CHAT_MESSAGE_READ_REFILL_PER_SECOND,
      now.getTime(),
      BUDGET_TTL_SECONDS,
    );
  } catch (error) {
    // Keep the read; tag the wide event so a Redis outage is not "no 429s".
    tryUseLogger()?.set({
      rateLimit: {
        failOpen: true,
        cause: error instanceof Error ? error.name : "unknown",
      },
    });
    return;
  }

  const [allowed, retryAfterSeconds] = result as [number, number];
  if (allowed === 1) {
    return;
  }

  throw tooManyRequests(
    "Chat history read budget exceeded. Use Ably realtime updates and retry history reads after the delay.",
    {
      kind: "message_read_budget_exceeded",
      retryAfterSeconds,
    },
  );
}
