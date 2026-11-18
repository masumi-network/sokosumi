import type { BetterAuthOptions } from "better-auth";

import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";

export function createAuthRateLimitStorage(
  prefix: string,
): NonNullable<BetterAuthOptions["secondaryStorage"]> {
  return {
    get: () => null,
    getAndDelete: () => null,
    set: () => {},
    delete: () => {},
    async increment(key, ttl) {
      const count = await incrementRedisRateLimit(
        `auth:rate-limit:${prefix}:${key}`,
        ttl,
      );
      return typeof count === "number" ? count : 0;
    },
  };
}
