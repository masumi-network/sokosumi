import { isIP } from "node:net";

import { getRedisClient } from "@/lib/redis";

const SIGNUP_LIMIT_SCRIPT = `
local count = redis.call("incr", KEYS[1])
if count == 1 then redis.call("expire", KEYS[1], 600) end
return count
`;

export async function allowNewsletterSignup(
  newsletterId: string,
  request: Request,
): Promise<boolean> {
  const forwarded = (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")
  )
    ?.split(",")[0]
    ?.trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : "unknown";
  const redis = getRedisClient();
  if (!redis) return true;
  try {
    const count = await redis.eval(
      SIGNUP_LIMIT_SCRIPT,
      1,
      `newsletter:signup:${newsletterId}:${ip}`,
    );
    return typeof count === "number" && count <= 10;
  } catch {
    // Match Core's chat budget: keep requests available during Redis outages.
    return true;
  }
}
