import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "@hono/zod-openapi";
import { hideSeoAuditRequest } from "@sokosumi/utils";
import pTimeout from "p-timeout";
import {
  classifyTaskTags,
  JEV_TASK_TAG_MODEL,
  taskTagEvaluationBatchCount,
  taskTagProviderAvailable,
} from "@/clients/task-tag-classifier";
import { getEnv } from "@/config/env";
import { serviceUnavailable, tooManyRequests } from "@/helpers/error";
import {
  loadTaskTagCatalog,
  type TaskTagEvaluation,
  type TaskWorkspaceTagCatalogEntry,
  taskTagCatalogFingerprint,
  workspaceTagSuggestion,
} from "@/helpers/task-tag-catalog";
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
const DOMAIN = "sokosumi:task-tag-suggestion:v2:";
// Keep the rolling limits shared with older deployments and future receipt versions.
const ADMISSION_PREFIX = "sokosumi:task-tag-suggestion:v1:2:";
const receiptSchema = z.object({
  userId: z.string(),
  workspaceId: z.string(),
  inputHash: z.string(),
  version: z.literal(TASK_TAG_VOCABULARY_VERSION),
  expiresAt: z.number().int(),
  tags: z.array(taskTagIdSchema).max(MAX_TASK_TAGS),
  catalogHash: z.string(),
  workspaceTags: z.array(z.tuple([z.uuid(), z.boolean()])).max(MAX_TASK_TAGS),
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
function issueEvaluationReceipt(
  scope: SuggestionScope,
  input: SuggestionInput,
  evaluation: TaskTagEvaluation,
  catalog: readonly TaskWorkspaceTagCatalogEntry[],
) {
  const payload = Buffer.from(
    JSON.stringify(
      receiptSchema.parse({
        ...scope,
        inputHash: inputHash(input),
        version: TASK_TAG_VOCABULARY_VERSION,
        expiresAt: Date.now() + TTL_SECONDS * 1000,
        tags: evaluation.tags,
        catalogHash: taskTagCatalogFingerprint(catalog),
        workspaceTags: evaluation.workspaceSuggestions.map(
          ({ id, autoApply }) => [id, autoApply],
        ),
      }),
    ),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function verifyTaskTagEvaluationReceipt(
  receipt: string | undefined,
  scope: SuggestionScope,
  input: SuggestionInput,
  catalog: readonly TaskWorkspaceTagCatalogEntry[],
): TaskTagEvaluation | null {
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
      parsed.inputHash !== inputHash(input) ||
      parsed.catalogHash !== taskTagCatalogFingerprint(catalog)
    )
      return null;
    const labels = new Map(catalog.map((label) => [label.id, label]));
    const workspaceSuggestions = [];
    for (const [id, autoApply] of parsed.workspaceTags) {
      const label = labels.get(id);
      if (!label) return null;
      workspaceSuggestions.push(workspaceTagSuggestion(label, autoApply));
      labels.delete(id);
    }
    return { tags: parsed.tags, workspaceSuggestions };
  } catch {
    return null;
  }
}

export function issueTaskTagReceipt(
  scope: SuggestionScope,
  input: SuggestionInput,
  tags: TaskTagEvaluation["tags"],
) {
  return issueEvaluationReceipt(
    scope,
    input,
    { tags, workspaceSuggestions: [] },
    [],
  );
}

export function verifyTaskTagReceipt(
  receipt: string | undefined,
  scope: SuggestionScope,
  input: SuggestionInput,
) {
  return (
    verifyTaskTagEvaluationReceipt(receipt, scope, input, [])?.tags ?? null
  );
}

// One atomic admission: content lease, user cooldown, and rolling user/workspace
// windows. Denied requests never consume another counter or extend a window.
const TASK_TAG_SUGGESTION_ADMISSION = `
if redis.call('EXISTS', KEYS[6]) == 1 then return -1 end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local batches = tonumber(ARGV[1])
local token = ARGV[2]
local wait = math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]), 0)
local windows = {60000, 3600000, 3600000}
local limits = {6, 60, 300}
for i = 1, 3 do
  local key = KEYS[i + 2]
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windows[i])
  -- A very large catalog can reserve one whole window when it is empty.
  local charge = math.min(batches, limits[i])
  local excess = redis.call('ZCARD', key) + charge - limits[i]
  if excess > 0 then
    local available = redis.call('ZRANGE', key, excess - 1, excess - 1, 'WITHSCORES')
    wait = math.max(wait, tonumber(available[2]) + windows[i] - now)
  end
end
if wait > 0 then return math.max(1, math.ceil(wait / 1000)) end
redis.call('SET', KEYS[1], token, 'PX', 20000)
redis.call('SET', KEYS[2], token, 'PX', 5000)
for i = 1, 3 do
  for batch = 1, math.min(batches, limits[i]) do
    redis.call('ZADD', KEYS[i + 2], now, token .. ':' .. batch)
  end
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

function suggestionCacheKey(
  scope: SuggestionScope,
  input: SuggestionInput,
  catalog: readonly TaskWorkspaceTagCatalogEntry[],
) {
  const scopeHash = createHash("sha256")
    .update(JSON.stringify([scope.userId, scope.workspaceId]))
    .digest("hex");
  return `${DOMAIN}${TASK_TAG_VOCABULARY_VERSION}:cache:${scopeHash}:${taskTagCatalogFingerprint(catalog)}:${inputHash(input)}`;
}

/** Reuse completed composer work without making creation depend on Redis. */
export async function readCachedTaskTagEvaluation(
  scope: SuggestionScope,
  input: SuggestionInput,
  catalog: readonly TaskWorkspaceTagCatalogEntry[],
) {
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const receipt = await pTimeout(
      redis.get(suggestionCacheKey(scope, input, catalog)),
      {
        milliseconds: 250,
        message: unavailable(),
      },
    );
    return verifyTaskTagEvaluationReceipt(
      receipt ?? undefined,
      scope,
      input,
      catalog,
    );
  } catch {
    return null;
  }
}

export async function readCachedTaskTagSuggestions(
  scope: SuggestionScope,
  input: SuggestionInput,
) {
  return (await readCachedTaskTagEvaluation(scope, input, []))?.tags ?? null;
}

function draftResponse(evaluation: TaskTagEvaluation, receipt: string) {
  return {
    tags: evaluation.tags,
    ...(evaluation.workspaceSuggestions.length > 0 && {
      workspaceSuggestions: evaluation.workspaceSuggestions.map(
        ({ id, displayName, color, customColor, autoApply }) => ({
          id,
          displayName,
          color,
          customColor,
          autoApply,
        }),
      ),
    }),
    receipt,
  };
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
  const catalog = await loadTaskTagCatalog(scope.workspaceId).catch(() => {
    throw unavailable();
  });
  const cacheKey = suggestionCacheKey(scope, input, catalog);
  const leaseKey = `${cacheKey}:lease`;
  const token = randomUUID();
  let admitted = false;
  try {
    const cached = await boundedRedis(redis.get(cacheKey));
    const evaluation = verifyTaskTagEvaluationReceipt(
      cached ?? undefined,
      scope,
      input,
      catalog,
    );
    if (cached && evaluation) return draftResponse(evaluation, cached);
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
            `${ADMISSION_PREFIX}cooldown:${scope.userId}`,
            `${ADMISSION_PREFIX}minute:${scope.userId}`,
            `${ADMISSION_PREFIX}hour:${scope.userId}`,
            `${ADMISSION_PREFIX}workspace:${scope.workspaceId}`,
            cacheKey,
            taskTagEvaluationBatchCount(catalog),
            token,
          ),
        ),
      );
    if (wait === -1) {
      const receipt = await boundedRedis(redis.get(cacheKey));
      const evaluation = verifyTaskTagEvaluationReceipt(
        receipt ?? undefined,
        scope,
        input,
        catalog,
      );
      if (receipt && evaluation) return draftResponse(evaluation, receipt);
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
        // Redact first: the request line is found by its line start, which normalize flattens.
        normalize(hideSeoAuditRequest(input.description)) || null,
        signal,
        catalog,
      ),
      { milliseconds: 12_000, signal },
    );
    if ("usage" in result)
      tryUseLogger()?.set({
        taskTagSuggestion: {
          model: JEV_TASK_TAG_MODEL,
          usage: result.usage,
          costUsd: result.costUsd,
          ...("costIncomplete" in result &&
            result.costIncomplete && { costIncomplete: true }),
          generationId: result.generationId,
          outcome: result.ok ? "complete" : "failed",
        },
      });
    if (!result.ok) throw unavailable();
    const receipt = issueEvaluationReceipt(scope, input, result, catalog);
    await boundedRedis(redis.set(cacheKey, receipt, "EX", TTL_SECONDS));
    return draftResponse(result, receipt);
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
