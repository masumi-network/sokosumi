import { randomUUID } from "node:crypto";
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

/** One serial bounded batch; content invalidation is durable even if a process exits. */
export async function classifyPendingTaskTags(context: SyncExecutionContext) {
  // Capability discovery never contains task content. No automatic global fallback.
  let available = false;
  try {
    available = await taskTagProviderAvailable(context.abortSignal);
  } catch {
    /* fail closed */
  }
  if (!available) return;
  const tasks = await prisma.task.findMany({
    where: {
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
  for (const task of tasks) {
    if (!context.shouldContinue() || context.msRemaining() < 15_000) break;
    const log = createCoreLogger({
      operation: "task_tag_classification",
      taskId: task.id,
      workspaceId: task.workspaceId,
      revision: task.tagContentRevision,
      model: JEV_TASK_TAG_MODEL,
    });
    try {
      const claimWhere = {
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: task.tagContentRevision,
        tagClassificationAttempts: task.tagClassificationAttempts,
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
        log.set({
          outcome: recovered.count ? "failed" : "stale",
          reason: "expired_final_lease",
        });
        continue;
      }
      const lease = randomUUID();
      const claimed = await prisma.task.updateMany({
        where: {
          ...claimWhere,
          tagClassificationState: { in: ["pending", "running"] },
        },
        data: {
          tagClassificationState: "running",
          tagClassificationLease: lease,
          tagClassificationAttempts: { increment: 1 },
          tagClassificationAvailableAt: new Date(Date.now() + LEASE_MS),
        },
      });
      if (!claimed.count) {
        log.set({ outcome: "stale" });
        continue;
      }
      const where = {
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: task.tagContentRevision,
        tagClassificationLease: lease,
      };
      let result: Awaited<ReturnType<typeof classifyTaskTags>> | undefined;
      try {
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
          log.set({ outcome: applied.count ? "complete" : "stale" });
          continue;
        }
        log.set({ outcome: "failed", reason: result.reason });
      }
      // Compare-and-set also protects a newer content revision from an old failure.
      await prisma.task.updateMany({
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
    } catch {
      // Keep the lease recoverable and allow unrelated tasks in this batch to run.
      log.set({ outcome: "failed", reason: "database_error" });
    } finally {
      log.emit();
    }
  }
}
