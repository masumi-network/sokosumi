import { randomUUID } from "node:crypto";
import { z } from "@hono/zod-openapi";
import pTimeout from "p-timeout";

import { serviceUnavailable, tooManyRequests } from "@/helpers/error";
import { getRedisClient } from "@/lib/redis";

export const EXPORT_OPERATION_DURATION_MS = 45_000;
export const EXPORT_LEASE_TTL_MS = 120_000;
const EXPORT_RATE_WINDOW_MS = 60_000;
const EXPORT_RATE_LIMIT = 5;
const REDIS_TIMEOUT_MS = 2_000;

// Admission and rate accounting must succeed together across all Web instances.
export const ACQUIRE_EXPORT_LEASE_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)
local lease_ttl = redis.call('PTTL', KEYS[1])
if lease_ttl == -1 then return -1 end
local wait = lease_ttl >= 0 and math.max(1, lease_ttl) or 0
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
  local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  wait = math.max(wait, tonumber(first[2]) + window - now)
end
if wait > 0 then return math.max(1, math.ceil(wait / 1000)) end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[2], window)
return 0
`;

export const RELEASE_EXPORT_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export function exportAdmissionKeys(userId: string): [string, string] {
  // A Redis hash tag keeps the user's keys together on clustered Redis.
  const prefix = `export:{${encodeURIComponent(userId)}}`;
  return [`${prefix}:lease`, `${prefix}:starts`];
}

function unavailable() {
  return serviceUnavailable("Exports are temporarily unavailable", {
    retryAfterSeconds: 30,
    reportToSentry: false,
    kind: "export_admission_unavailable",
  });
}

async function evaluate(
  script: string,
  keys: string[],
  args: (string | number)[],
) {
  try {
    const redis = getRedisClient();
    if (!redis) throw unavailable();
    return await pTimeout(redis.eval(script, keys.length, ...keys, ...args), {
      milliseconds: REDIS_TIMEOUT_MS,
      message: unavailable(),
    });
  } catch {
    throw unavailable();
  }
}

export async function acquireExportLease(userId: string) {
  const token = randomUUID();
  const result = z
    .number()
    .int()
    .nonnegative()
    .safeParse(
      await evaluate(ACQUIRE_EXPORT_LEASE_SCRIPT, exportAdmissionKeys(userId), [
        token,
        EXPORT_LEASE_TTL_MS,
        EXPORT_RATE_WINDOW_MS,
        EXPORT_RATE_LIMIT,
      ]),
    );
  if (!result.success) throw unavailable();
  if (result.data > 0) {
    throw tooManyRequests("Please wait before exporting another document", {
      retryAfterSeconds: result.data,
      kind: "export_limit_exceeded",
    });
  }
  return { token, durationMs: EXPORT_OPERATION_DURATION_MS };
}

export async function releaseExportLease(userId: string, token: string) {
  const [leaseKey] = exportAdmissionKeys(userId);
  const result = z
    .union([z.literal(0), z.literal(1)])
    .safeParse(
      await evaluate(RELEASE_EXPORT_LEASE_SCRIPT, [leaseKey], [token]),
    );
  if (!result.success) throw unavailable();
  return { released: result.data === 1 };
}
