import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";

/** Atomic ten-minute window, matching Core's fail-open chat read budget. */
export async function allowNewsletterRequest(key: string, limit: number) {
  const count = await incrementRedisRateLimit(key, 600);
  // Match Core's chat budget: keep requests available during Redis outages.
  return count === undefined || (typeof count === "number" && count <= limit);
}
