import { tryUseLogger } from "@/lib/evlog";
import { getRedisRateLimitClient } from "@/lib/redis";

const INCREMENT_RATE_LIMIT_SCRIPT = `
local count = redis.call("incr", KEYS[1])
if count == 1 then redis.call("expire", KEYS[1], ARGV[1]) end
return count
`;

export async function evalRedisRateLimit(
  script: string,
  key: string,
  ...args: number[]
): Promise<unknown> {
  let cause = "redis_not_configured";
  try {
    const redis = getRedisRateLimitClient();
    if (redis?.status === "ready") {
      return await redis.eval(script, 1, key, ...args);
    }
    if (redis) cause = "redis_not_ready";
  } catch (error) {
    cause = error instanceof Error ? error.name : "unknown";
  }
  tryUseLogger()?.set({ rateLimit: { failOpen: true, cause } });
  return undefined;
}

export function incrementRedisRateLimit(key: string, ttl: number) {
  return evalRedisRateLimit(INCREMENT_RATE_LIMIT_SCRIPT, key, ttl);
}
