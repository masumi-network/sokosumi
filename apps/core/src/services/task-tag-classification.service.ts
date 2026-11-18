import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import pTimeout from "p-timeout";
import {
  classifyTaskTags,
  JEV_TASK_TAG_MODEL,
  taskTagProviderAvailable,
} from "@/clients/task-tag-classifier";
import { getEnv } from "@/config/env";
import {
  loadTaskTagCatalog,
  type TaskTagEvaluation,
} from "@/helpers/task-tag-catalog";
import { TASK_TAG_VOCABULARY_VERSION } from "@/helpers/task-tags";
import { applyJevWorkspaceTags } from "@/helpers/task-workspace-tags";
import { publishTaskEventData } from "@/lib/ably/publish";
import { aiGatewayApiKey } from "@/lib/ai-gateway-purpose";
import prisma from "@/lib/db/prisma";
import { createCoreLogger, tryUseLogger } from "@/lib/evlog";
import type { SyncExecutionContext } from "@/routes/sync/handler";
import {
  readCachedTaskTagEvaluation,
  verifyTaskTagEvaluationReceipt,
} from "@/services/task-tag-suggestions.service";

// Creates, edits and retries are interactive work and always go first. A burst of
// them is still bounded, because every claim is one serial provider call.
const QUEUED_BATCH_SIZE = 50;
// Historical backfill is a fixed, finite set of rows, so a higher rate drains the
// backlog sooner without raising total spend at all. Production measured 310-435ms
// per task end to end, so 200 is roughly 62-87s of the ~260s usable budget below.
const HISTORICAL_BATCH_SIZE = 200;
const MAX_ATTEMPTS = 2;
// Keep a recovered historical lease in the default-topic backfill.
const HISTORICAL_LEASE_PREFIX = "historical:";
const LEASE_MS = 60_000;
// One evaluation can take the classifier's full 12s request timeout plus its writes.
const DEADLINE_RESERVE_MS = 15_000;
// The sync deadline is `LOCK_TIMEOUT - LOCK_TIMEOUT_BUFFER`, 275s on the defaults
// production runs on, and the cron fires every 300s. A tick that ran to that
// deadline would still release its lock in time, but only by ~25s, and cron jitter,
// a slow release or a function killed at vercel.json's 300s maxDuration all eat
// that margin; a tick that is still holding the lock makes the next one 409 and
// skips it entirely. Up to 250 rows could reach the deadline where 10 never could,
// so a tick stops claiming new work here and leaves a wide margin instead. The sync
// deadline above stays the outer bound.
const TICK_BUDGET_MS = 120_000;
// Check reported spend between Tasks. A 250-row built-in-only tick cost about
// $0.01 at the measured ~$0.0000373 per Task. Workspace vocabulary can require
// multiple requests per Task. Finish all its batches so the last evaluation can
// exceed the threshold by one Task's cost. Queued rows share this budget.
// Selection and time caps still bound ticks when the provider omits billing.
const MAX_TICK_COST_USD = 0.05;
// Only the columns this worker reads. A 250-row batch must not pull whole task
// rows, whose descriptions have no length cap in the database.
const TASK_FIELDS = {
  id: true,
  workspaceId: true,
  ownerId: true,
  name: true,
  description: true,
  tagContentRevision: true,
  tagClassificationAttempts: true,
  tagClassificationState: true,
  tagClassificationLease: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

// A create must never wait on the provider. Production measures 310-435ms per
// evaluation end to end, so this ceiling is roughly six times the observed latency
// and still short enough that a stalled Gateway costs the caller almost nothing.
const INLINE_TIMEOUT_MS = 2_500;

interface InlineTagInput {
  name: string;
  description?: string | null;
  workspaceId: string;
  composer?: { userId: string; name?: string; receipt?: string };
}

async function evaluateInline(
  input: InlineTagInput,
  enabled: boolean,
  signal: AbortSignal,
): Promise<TaskTagEvaluation | null> {
  const catalog = await loadTaskTagCatalog(input.workspaceId);
  signal.throwIfAborted();
  if (input.composer) {
    const scope = {
      workspaceId: input.workspaceId,
      userId: input.composer.userId,
    };
    const authored = {
      name: input.composer.name,
      description: input.description,
    };
    const cached =
      verifyTaskTagEvaluationReceipt(
        input.composer.receipt,
        scope,
        authored,
        catalog,
      ) ?? (await readCachedTaskTagEvaluation(scope, authored, catalog));
    if (cached) return cached;
  }
  if (!enabled) return null;
  signal.throwIfAborted();
  const result = await classifyTaskTags(
    input.name,
    input.description ?? null,
    signal,
    catalog,
  );
  // Keep validated billing metadata even when the answers themselves failed.
  tryUseLogger()?.set({
    taskTagInlineClassification: {
      model: JEV_TASK_TAG_MODEL,
      outcome: result.ok ? "complete" : "failed",
      ...(result.ok ? {} : { reason: result.reason }),
      ...("usage" in result
        ? {
            usage: result.usage,
            costUsd: result.costUsd,
            generationId: result.generationId,
            ...("costIncomplete" in result && { costIncomplete: true }),
          }
        : {}),
    },
  });
  return result.ok
    ? { tags: result.tags, workspaceSuggestions: result.workspaceSuggestions }
    : null;
}

/**
 * Best-effort classification on the create path, for every actor.
 *
 * Returns null for every failure mode — the feature flag off, no Gateway key, a
 * 5xx, a policy rejection, a timeout, a 429, an unparseable answer — and never
 * throws. A null result means the caller writes no tag columns, so the row keeps
 * the `pending` state its insert trigger set and `/sync/task-tags` drains it on a
 * later tick. This moves the provider call the cron would have made anyway; it does
 * not add one.
 */
export async function classifyTaskTagsInline(
  input: InlineTagInput,
): Promise<TaskTagEvaluation | null> {
  // A local flag check, not the catalog probe: one fewer round trip per create.
  const enabled = Boolean(
    getEnv().TASK_TAG_CLASSIFICATION_ENABLED && aiGatewayApiKey(),
  );
  if (!enabled && !input.composer?.receipt) return null;
  try {
    const signal = AbortSignal.timeout(INLINE_TIMEOUT_MS);
    return await pTimeout(evaluateInline(input, enabled, signal), {
      milliseconds: INLINE_TIMEOUT_MS,
      signal,
    });
  } catch {
    // Never include provider bodies, task content, or credentials in a log line.
    tryUseLogger()?.set({
      taskTagInlineClassification: {
        model: JEV_TASK_TAG_MODEL,
        outcome: "failed",
        reason: "provider_unavailable_or_timeout",
      },
    });
    return null;
  }
}

export async function classifyPendingTaskTags(context: SyncExecutionContext) {
  return runPendingTaskTags(context, {});
}

export async function classifyFixtureTaskTags(
  context: SyncExecutionContext,
  scope: { taskId: string; ownerId: string; backfill?: true },
) {
  // Missing fixture identity must never broaden this into a queue-wide run.
  if (!scope?.taskId || !scope.ownerId) return;
  const fixtureScope = {
    id: scope.taskId,
    ownerId: scope.ownerId,
    name: { startsWith: "SYNTHETIC " },
    status: "DRAFT",
  } satisfies Prisma.TaskWhereInput;
  if (scope.backfill) {
    // Preview route only: construct a historical fixture without DB credentials.
    // A rerun, edited revision or real task can never be reset by this setup.
    const prepared = await prisma.task.updateMany({
      where: {
        ...fixtureScope,
        archivedAt: null,
        tagClassificationState: "pending",
        tagContentRevision: 1,
        tagClassificationAttempts: 0,
        tagClassificationLease: null,
        automaticTags: { isEmpty: true },
      },
      data: { tagClassificationState: "unclassified" },
    });
    const log = createCoreLogger({
      operation: "task_tag_classification_fixture_preparation",
    });
    log.set({ source: "historical", prepared: prepared.count });
    log.emit();
  }
  return runPendingTaskTags(context, fixtureScope);
}

/** Preserve a human edit made after the worker read the queued row. */
async function updateClassification(
  db: Prisma.TransactionClient,
  update: {
    where: Prisma.TaskWhereInput;
    data: Prisma.TaskUpdateManyMutationInput & { updatedAt: Date };
  },
) {
  const write = (updatedAt: Date) =>
    db.task.updateMany({
      where: { ...update.where, updatedAt },
      data: { ...update.data, updatedAt },
    });
  const original = await write(update.data.updatedAt);
  if (original.count) return original;
  // A changed lease or revision still fails the original predicate.
  const newer = await db.task.findFirst({
    where: { ...update.where, updatedAt: { not: update.data.updatedAt } },
    select: { updatedAt: true },
  });
  return newer ? write(newer.updatedAt) : original;
}

/** One serial bounded batch; content invalidation is durable even if a process exits. */
async function runPendingTaskTags(
  context: SyncExecutionContext,
  scope: Prisma.TaskWhereInput,
) {
  const startedAt = Date.now();
  const activeScope: Prisma.TaskWhereInput = {
    status: { not: "GRANT_PENDING" },
    ...scope,
  };
  // Discovery contains no task content; each evaluation enforces privacy options.
  let available = false;
  try {
    available = await taskTagProviderAvailable(context.abortSignal);
  } catch {
    /* fail closed */
  }
  if (!available) return;
  const tasks = await prisma.task.findMany({
    where: {
      ...activeScope,
      archivedAt: null,
      tagClassificationState: { in: ["pending", "running"] },
      tagClassificationAvailableAt: { lte: new Date() },
      OR: [
        { tagClassificationAttempts: { lt: MAX_ATTEMPTS } },
        {
          tagClassificationState: "running",
          tagClassificationAttempts: { gte: MAX_ATTEMPTS },
        },
      ],
    },
    orderBy: [{ tagClassificationAvailableAt: "asc" }, { id: "asc" }],
    take: QUEUED_BATCH_SIZE,
    select: TASK_FIELDS,
  });
  // Historical work runs behind every queued row, under its own cap and its own
  // time budget. Existing state + lease fields are the durable cursor across
  // ticks; no mass enqueue or migration is needed.
  const queued = tasks.length;
  const historicalWhere = {
    ...activeScope,
    archivedAt: null,
    tagClassificationState: "unclassified",
    tagClassificationAttempts: { lt: MAX_ATTEMPTS },
    tagClassificationAvailableAt: { lte: new Date() },
  } satisfies Prisma.TaskWhereInput;
  const timeLeft = () =>
    context.shouldContinue() &&
    context.msRemaining() >= DEADLINE_RESERVE_MS &&
    Date.now() - startedAt < TICK_BUDGET_MS;
  if (timeLeft()) {
    tasks.push(
      ...(await prisma.task.findMany({
        where: historicalWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: HISTORICAL_BATCH_SIZE,
        select: TASK_FIELDS,
      })),
    );
  }
  const progress = {
    selected: tasks.length,
    queued,
    historical: tasks.length - queued,
    attempted: 0,
    completed: 0,
    failed: 0,
    stale: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    unreportedCost: 0,
  };
  let stopReason: "deadline" | "tick_budget" | "spend_ceiling" | undefined;
  for (const task of tasks) {
    const source =
      task.tagClassificationState === "unclassified" ||
      task.tagClassificationLease?.startsWith(HISTORICAL_LEASE_PREFIX)
        ? "historical"
        : "queued";
    if (
      !context.shouldContinue() ||
      context.msRemaining() < DEADLINE_RESERVE_MS
    ) {
      stopReason = "deadline";
      break;
    }
    if (progress.costUsd >= MAX_TICK_COST_USD) {
      stopReason = "spend_ceiling";
      break;
    }
    // Whatever is left keeps its durable state and resumes on the next tick.
    if (Date.now() - startedAt >= TICK_BUDGET_MS) {
      stopReason = "tick_budget";
      break;
    }
    const log = createCoreLogger({
      operation: "task_tag_classification",
      taskId: task.id,
      workspaceId: task.workspaceId,
      revision: task.tagContentRevision,
      model: JEV_TASK_TAG_MODEL,
      source,
    });
    let outcome: "completed" | "failed" | "stale" = "failed";
    try {
      const claimWhere = {
        ...activeScope,
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: task.tagContentRevision,
        tagClassificationAttempts: task.tagClassificationAttempts,
        tagClassificationState: task.tagClassificationState,
        tagClassificationLease: task.tagClassificationLease,
        tagClassificationAvailableAt: { lte: new Date() },
      };
      if (task.tagClassificationAttempts >= MAX_ATTEMPTS) {
        // An abandoned final attempt must terminate without sending content again.
        const recovered = await updateClassification(prisma, {
          where: {
            ...claimWhere,
            tagClassificationState: "running",
            tagClassificationLease: task.tagClassificationLease,
          },
          data: {
            tagClassificationState: "failed",
            tagClassificationLease: null,
            updatedAt: task.updatedAt,
          },
        });
        outcome = recovered.count ? "failed" : "stale";
        log.set({
          outcome,
          reason: "expired_final_lease",
        });
        continue;
      }
      const lease =
        source === "historical"
          ? HISTORICAL_LEASE_PREFIX + randomUUID()
          : randomUUID();
      const claimed = await updateClassification(prisma, {
        where: claimWhere,
        data: {
          tagClassificationState: "running",
          tagClassificationLease: lease,
          tagClassificationAttempts: { increment: 1 },
          tagClassificationAvailableAt: new Date(Date.now() + LEASE_MS),
          // Tagging is bookkeeping, not a change to the Task: keep its
          // updatedAt, or a backfill floats every old Task to "just touched".
          updatedAt: task.updatedAt,
        },
      });
      if (!claimed.count) {
        outcome = "stale";
        log.set({ outcome });
        continue;
      }
      const where = {
        ...activeScope,
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: task.tagContentRevision,
        tagClassificationLease: lease,
      };
      let result: Awaited<ReturnType<typeof classifyTaskTags>> | undefined;
      try {
        progress.attempted++;
        progress.unreportedCost++;
        const catalog =
          source === "historical"
            ? []
            : await loadTaskTagCatalog(task.workspaceId);
        result = await classifyTaskTags(
          task.name,
          task.description,
          context.abortSignal,
          catalog,
        );
      } catch {
        log.set({ outcome: "failed", reason: "provider_or_validation_error" });
      }
      if (result) {
        // Retain validated billing metadata even when answers or persistence fail.
        if ("usage" in result) {
          progress.usage.inputTokens += result.usage.inputTokens;
          progress.usage.outputTokens += result.usage.outputTokens;
          if (result.costUsd !== null) {
            if (!("costIncomplete" in result)) progress.unreportedCost--;
            progress.costUsd += Number(result.costUsd);
          }
          log.set({
            usage: result.usage,
            costUsd: result.costUsd,
            generationId: result.generationId,
            ...("costIncomplete" in result && { costIncomplete: true }),
          });
        }
        if (result.ok) {
          const update = {
            where,
            data: {
              automaticTags: result.tags,
              tagClassificationState: "complete",
              tagClassificationLease: null,
              tagVocabularyVersion: TASK_TAG_VOCABULARY_VERSION,
              updatedAt: task.updatedAt,
            },
          } satisfies Prisma.TaskUpdateManyArgs;
          const suggestions = result.workspaceSuggestions;
          let changedWorkspaceTags = 0;
          const applied = suggestions.length
            ? await prisma.$transaction(async (tx) => {
                const changed = await updateClassification(tx, update);
                if (changed.count)
                  changedWorkspaceTags = await applyJevWorkspaceTags(
                    tx,
                    task.id,
                    task.workspaceId,
                    suggestions,
                  );
                return changed;
              })
            : await updateClassification(prisma, update);
          outcome = applied.count ? "completed" : "stale";
          log.set({ outcome: applied.count ? "complete" : "stale" });
          if (changedWorkspaceTags && task.ownerId) {
            try {
              await publishTaskEventData({
                userId: task.ownerId,
                taskId: task.id,
                eventType: "task_event",
              });
            } catch {
              log.set({ tagNotification: "publish_failed" });
            }
          }
          continue;
        }
        log.set({ outcome: "failed", reason: result.reason });
      }
      // Compare-and-set also protects a newer content revision from an old failure.
      const released = await updateClassification(prisma, {
        where,
        data: {
          tagClassificationState:
            task.tagClassificationAttempts + 1 >= MAX_ATTEMPTS
              ? "failed"
              : source === "historical"
                ? "unclassified"
                : "pending",
          tagClassificationLease: null,
          tagClassificationAvailableAt: new Date(Date.now() + LEASE_MS),
          updatedAt: task.updatedAt,
        },
      });
      if (!released.count) {
        outcome = "stale";
        log.set({ outcome });
      }
    } catch {
      // Keep the lease recoverable and allow unrelated tasks in this batch to run.
      log.set({ outcome: "failed", reason: "database_error" });
    } finally {
      progress[outcome]++;
      log.emit();
    }
  }
  const batchLog = createCoreLogger({
    operation: "task_tag_classification_batch",
    model: JEV_TASK_TAG_MODEL,
  });
  const summary = {
    ...progress,
    deferred:
      progress.selected - progress.completed - progress.failed - progress.stale,
    ...(stopReason ? { stopReason } : {}),
  };
  try {
    batchLog.set({
      ...summary,
      remainingHistorical: await prisma.task.count({ where: historicalWhere }),
    });
  } catch {
    // Progress visibility must not fail work already durably classified.
    batchLog.set({ ...summary, progressError: "database_error" });
  }
  batchLog.emit();
}
