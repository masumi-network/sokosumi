import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "@hono/zod-openapi";
import pTimeout from "p-timeout";
import {
  classifyTaskTags,
  JEV_TASK_TAG_MODEL,
  taskTagProviderAvailable,
} from "@/clients/task-tag-classifier";
import { getEnv } from "@/config/env";
import { serviceUnavailable, tooManyRequests } from "@/helpers/error";
import {
  MAX_TASK_TAGS,
  TASK_TAG_VOCABULARY_VERSION,
  taskTagIdSchema,
} from "@/helpers/task-tags";
import { tryUseLogger } from "@/lib/evlog";
import { getRedisClient } from "@/lib/redis";

interface SuggestionScope {
  userId: string;
  workspaceId: string;
}
interface SuggestionInput {
  name?: string;
  description?: string | null;
}
const TTL_SECONDS = 900;
const DOMAIN = "sokosumi:task-tag-suggestion:v1:";
const receiptSchema = z.object({
  userId: z.string(),
  workspaceId: z.string(),
  inputHash: z.string(),
  version: z.literal(TASK_TAG_VOCABULARY_VERSION),
  expiresAt: z.number().int(),
  tags: z.array(taskTagIdSchema).max(MAX_TASK_TAGS),
});
function normalize(value?: string | null) {
  return (value ?? "").trim().replace(/\s+/gu, " ");
}
function inputHash(input: SuggestionInput) {
  return createHash("sha256")
    .update(
      JSON.stringify([normalize(input.name), normalize(input.description)]),
    )
    .digest("hex");
}
function signature(payload: string) {
  return createHmac("sha256", getEnv().BETTER_AUTH_SECRET)
    .update(DOMAIN + payload)
    .digest();
}
export function issueTaskTagReceipt(
  scope: SuggestionScope,
  input: SuggestionInput,
  tags: z.infer<typeof taskTagIdSchema>[],
) {
  const payload = Buffer.from(
    JSON.stringify(
      receiptSchema.parse({
        ...scope,
        inputHash: inputHash(input),
        version: TASK_TAG_VOCABULARY_VERSION,
        expiresAt: Date.now() + TTL_SECONDS * 1000,
        tags,
      }),
    ),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyTaskTagReceipt(
  receipt: string | undefined,
  scope: SuggestionScope,
  input: SuggestionInput,
) {
  try {
    if (!receipt || receipt.length > 4_096) return null;
    const [payload, mac, extra] = receipt.split(".");
    if (!payload || !mac || extra !== undefined) return null;
    const expected = signature(payload);
    const supplied = Buffer.from(mac, "base64url");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return null;
    const parsed = receiptSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (
      parsed.expiresAt <= Date.now() ||
      parsed.expiresAt > Date.now() + TTL_SECONDS * 1000 ||
      parsed.userId !== scope.userId ||
      parsed.workspaceId !== scope.workspaceId ||
      parsed.inputHash !== inputHash(input)
    )
      return null;
    return parsed.tags;
  } catch {
    return null;
  }
}

// One atomic admission: content lease, user cooldown, and rolling user/workspace
// windows. Denied requests never consume another counter or extend a window.
export const TASK_TAG_SUGGESTION_ADMISSION = `
if redis.call('EXISTS', KEYS[6]) == 1 then return -1 end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local token = ARGV[1]
local wait = math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]), 0)
local windows = {60000, 3600000, 3600000}
local limits = {6, 60, 300}
for i = 1, 3 do
  local key = KEYS[i + 2]
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windows[i])
  if redis.call('ZCARD', key) >= limits[i] then
    local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    wait = math.max(wait, tonumber(first[2]) + windows[i] - now)
  end
end
if wait > 0 then return math.max(1, math.ceil(wait / 1000)) end
redis.call('SET', KEYS[1], token, 'PX', 20000)
redis.call('SET', KEYS[2], token, 'PX', 5000)
for i = 1, 3 do
  redis.call('ZADD', KEYS[i + 2], now, token)
  redis.call('PEXPIRE', KEYS[i + 2], windows[i])
end
return 0
`;
const RELEASE =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
function unavailable() {
  return serviceUnavailable("Tag suggestions are temporarily unavailable", {
    retryAfterSeconds: 30,
    reportToSentry: false,
    kind: "tag_suggestions_unavailable",
  });
}

function boundedRedis<T>(operation: Promise<T>) {
  return pTimeout(operation, { milliseconds: 2_000, message: unavailable() });
}

function suggestionCacheKey(scope: SuggestionScope, input: SuggestionInput) {
  const scopeHash = createHash("sha256")
    .update(JSON.stringify(scope))
    .digest("hex");
  return `${DOMAIN}${TASK_TAG_VOCABULARY_VERSION}:cache:${scopeHash}:${inputHash(input)}`;
}

/** Reuse completed composer work without making creation depend on Redis. */
export async function readCachedTaskTagSuggestions(
  scope: SuggestionScope,
  input: SuggestionInput,
) {
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const receipt = await pTimeout(
      redis.get(suggestionCacheKey(scope, input)),
      {
        milliseconds: 250,
        message: unavailable(),
      },
    );
    return verifyTaskTagReceipt(receipt ?? undefined, scope, input);
  } catch {
    return null;
  }
}

export async function suggestTaskTags(
  scope: SuggestionScope,
  input: SuggestionInput,
) {
  let redis: ReturnType<typeof getRedisClient>;
  try {
    redis = getRedisClient();
  } catch {
    throw unavailable();
  }
  if (!redis) throw unavailable();
  const prefix = `${DOMAIN}${TASK_TAG_VOCABULARY_VERSION}:`;
  const cacheKey = suggestionCacheKey(scope, input);
  const leaseKey = `${cacheKey}:lease`;
  const token = randomUUID();
  let admitted = false;
  try {
    const cached = await boundedRedis(redis.get(cacheKey));
    const tags = verifyTaskTagReceipt(cached ?? undefined, scope, input);
    if (cached && tags !== null) return { tags, receipt: cached };
    const wait = z
      .number()
      .int()
      .min(-1)
      .parse(
        await boundedRedis(
          redis.eval(
            TASK_TAG_SUGGESTION_ADMISSION,
            6,
            leaseKey,
            `${prefix}cooldown:${scope.userId}`,
            `${prefix}minute:${scope.userId}`,
            `${prefix}hour:${scope.userId}`,
            `${prefix}workspace:${scope.workspaceId}`,
            cacheKey,
            token,
          ),
        ),
      );
    if (wait === -1) {
      const receipt = await boundedRedis(redis.get(cacheKey));
      const cachedTags = verifyTaskTagReceipt(
        receipt ?? undefined,
        scope,
        input,
      );
      if (receipt && cachedTags !== null) return { tags: cachedTags, receipt };
      throw unavailable();
    }
    if (wait > 0)
      throw tooManyRequests(
        "Please wait before requesting more tag suggestions",
        { retryAfterSeconds: wait, kind: "tag_suggestions_throttled" },
      );
    admitted = true;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 429)
      throw error;
    throw unavailable();
  }
  try {
    const signal = AbortSignal.timeout(12_000);
    if (
      !(await pTimeout(taskTagProviderAvailable(signal), {
        milliseconds: 12_000,
        signal,
      }))
    )
      throw unavailable();
    const result = await pTimeout(
      classifyTaskTags(
        normalize(input.name),
        normalize(input.description) || null,
        signal,
      ),
      { milliseconds: 12_000, signal },
    );
    if ("usage" in result)
      tryUseLogger()?.set({
        taskTagSuggestion: {
          model: JEV_TASK_TAG_MODEL,
          usage: result.usage,
          costUsd: result.costUsd,
          generationId: result.generationId,
          outcome: result.ok ? "complete" : "failed",
        },
      });
    if (!result.ok) throw unavailable();
    const receipt = issueTaskTagReceipt(scope, input, result.tags);
    await boundedRedis(redis.set(cacheKey, receipt, "EX", TTL_SECONDS));
    return { tags: result.tags, receipt };
  } catch {
    throw unavailable();
  } finally {
    if (admitted) {
      try {
        await boundedRedis(redis.eval(RELEASE, 1, leaseKey, token));
      } catch {
        /* Lease expires without unlocking another owner's work. */
      }
    }
  }
}
