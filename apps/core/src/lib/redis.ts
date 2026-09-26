import Redis from "ioredis";

import { getEnv } from "@/config/env";

let cachedClient: Redis | null | undefined;

export function getRedisUrl(): string | null {
  const env = getEnv();
  const url = env.REDIS_URL?.trim() || env.KV_URL?.trim() || "";
  return url.length > 0 ? url : null;
}

export function getRedisClient(): Redis | null {
  const url = getRedisUrl();
  if (!url) {
    return null;
  }

  if (cachedClient === undefined) {
    cachedClient = new Redis(url);
  }

  return cachedClient;
}
