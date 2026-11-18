import Redis from "ioredis";

import { getEnv } from "@/config/env";
import { emitCoreWarning } from "@/lib/evlog";

let cachedClient: Redis | undefined;
let cachedRateLimitClient: Redis | undefined;
const RATE_LIMIT_COMMAND_TIMEOUT_MS = 250;
const RATE_LIMIT_SOCKET_TIMEOUT_MS = 1_000;

function watchRedisConnection(client: Redis, purpose: "shared" | "rate_limit") {
  let warnOnError = true;
  client.on("ready", () => {
    warnOnError = true;
  });
  // Callers handle command failures. Keep reconnect events out of stderr.
  client.on("error", (error) => {
    if (!warnOnError) return;
    warnOnError = false;
    emitCoreWarning(
      { operation: "redis_connection", redis: { purpose } },
      {
        message: "Redis connection failed",
        why: "Core could not establish or keep a Redis connection.",
        fix: "Check the Redis service and Core's connection settings.",
        cause: error,
      },
    );
  });
  return client;
}

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

  cachedClient ??= watchRedisConnection(new Redis(url), "shared");

  return cachedClient;
}

export function getRedisRateLimitClient(): Redis | null {
  const url = getRedisUrl();
  if (!url) return null;

  cachedRateLimitClient ??= watchRedisConnection(
    new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      commandTimeout: RATE_LIMIT_COMMAND_TIMEOUT_MS,
      socketTimeout: RATE_LIMIT_SOCKET_TIMEOUT_MS,
    }),
    "rate_limit",
  );
  return cachedRateLimitClient;
}
