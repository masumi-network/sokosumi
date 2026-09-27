import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
  classifyTaskTags,
  JEV_TASK_TAG_MODEL,
  taskTagProviderAvailable,
} from "@/clients/task-tag-classifier";
import { TASK_TAG_VOCABULARY_VERSION } from "@/helpers/task-tags";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import type { SyncExecutionContext } from "@/routes/sync/handler";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 2;
const LEASE_MS = 60_000;

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

/** One serial bounded batch; content invalidation is durable even if a process exits. */
async function runPendingTaskTags(
  context: SyncExecutionContext,
  scope: Prisma.TaskWhereInput,
) {
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
      ...scope,
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
    take: BATCH_SIZE,
  });
  // Historical work consumes only capacity left by due creates/edits/retries.
  // Existing state + lease fields are the durable cursor; no mass enqueue needed.
  const queued = tasks.length;
  const historicalWhere = {
    ...scope,
    archivedAt: null,
    tagClassificationState: "unclassified",
    tagClassificationAttempts: { lt: MAX_ATTEMPTS },
    tagClassificationAvailableAt: { lte: new Date() },
  } satisfies Prisma.TaskWhereInput;
  if (
    queued < BATCH_SIZE &&
    context.shouldContinue() &&
    context.msRemaining() >= 15_000
  ) {
    tasks.push(
      ...(await prisma.task.findMany({
        where: historicalWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE - queued,
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
  for (const task of tasks) {
    if (!context.shouldContinue() || context.msRemaining() < 15_000) break;
    const log = createCoreLogger({
      operation: "task_tag_classification",
      taskId: task.id,
      workspaceId: task.workspaceId,
      revision: task.tagContentRevision,
      model: JEV_TASK_TAG_MODEL,
      source:
        task.tagClassificationState === "unclassified"
          ? "historical"
          : "queued",
    });
    let outcome: "completed" | "failed" | "stale" = "failed";
    try {
      const claimWhere = {
        ...scope,
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
        const recovered = await prisma.task.updateMany({
          where: {
            ...claimWhere,
            tagClassificationState: "running",
            tagClassificationLease: task.tagClassificationLease,
          },
          data: {
            tagClassificationState: "failed",
            tagClassificationLease: null,
          },
        });
        outcome = recovered.count ? "failed" : "stale";
        log.set({
          outcome,
          reason: "expired_final_lease",
        });
        continue;
      }
      const lease = randomUUID();
      const claimed = await prisma.task.updateMany({
        where: claimWhere,
        data: {
          tagClassificationState: "running",
          tagClassificationLease: lease,
          tagClassificationAttempts: { increment: 1 },
          tagClassificationAvailableAt: new Date(Date.now() + LEASE_MS),
        },
      });
      if (!claimed.count) {
        outcome = "stale";
        log.set({ outcome });
        continue;
      }
      const where = {
        ...scope,
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
        result = await classifyTaskTags(
          task.name,
          task.description,
          context.abortSignal,
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
            progress.unreportedCost--;
            progress.costUsd += Number(result.costUsd);
          }
          log.set({
            usage: result.usage,
            costUsd: result.costUsd,
            generationId: result.generationId,
          });
        }
        if (result.ok) {
          const applied = await prisma.task.updateMany({
            where,
            data: {
              automaticTags: result.tags,
              tagClassificationState: "complete",
              tagClassificationLease: null,
              tagVocabularyVersion: TASK_TAG_VOCABULARY_VERSION,
            },
          });
          outcome = applied.count ? "completed" : "stale";
          log.set({ outcome: applied.count ? "complete" : "stale" });
          continue;
        }
        log.set({ outcome: "failed", reason: result.reason });
      }
      // Compare-and-set also protects a newer content revision from an old failure.
      const released = await prisma.task.updateMany({
        where,
        data: {
          tagClassificationState:
            task.tagClassificationAttempts + 1 >= MAX_ATTEMPTS
              ? "failed"
              : "pending",
          tagClassificationLease: null,
          tagClassificationAvailableAt: new Date(Date.now() + LEASE_MS),
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
