import Redis from "ioredis";

let cachedClient: Redis | null | undefined;

function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim() || process.env.KV_URL?.trim() || "";
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
