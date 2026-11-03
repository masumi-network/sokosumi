import { getRedisClient } from "@/lib/redis";

const LIMIT_SCRIPT = `
local count = redis.call("incr", KEYS[1])
if count == 1 then redis.call("expire", KEYS[1], 600) end
return count
`;

/** Atomic ten-minute window, matching Core's fail-open chat read budget. */
export async function allowNewsletterRequest(key: string, limit: number) {
  const redis = getRedisClient();
  if (!redis) return true;
  try {
    const count = await redis.eval(LIMIT_SCRIPT, 1, key);
    return typeof count === "number" && count <= limit;
  } catch {
    // Match Core's chat budget: keep requests available during Redis outages.
    return true;
  }
}
