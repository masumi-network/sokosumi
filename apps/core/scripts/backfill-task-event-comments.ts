#!/usr/bin/env tsx

/**
 * One-shot backfill script for historical TaskEvent comments.
 *
 * Scans TaskEvent.comment (never Task.description) and enqueues PENDING
 * TASK_OUTPUT TaskFiles for file-like URLs. Idempotent on (taskId, sourceUrl).
 * Does not reset FAILED rows. Safe to re-run.
 *
 * Usage (local preview with custom connection_limit):
 *   # Set DATABASE_URL with connection_limit matching concurrency (default 16):
 *   # postgresql://user:pass@host:5432/db?connection_limit=16
 *   #
 *   # Full run with concurrency
 *   tsx apps/core/scripts/backfill-task-event-comments.ts --concurrency=16
 *
 *   # Dry-run to preview
 *   tsx apps/core/scripts/backfill-task-event-comments.ts --dry-run --limit=1000
 *
 *   # Resume from a specific point (use last logged event ID)
 *   tsx apps/core/scripts/backfill-task-event-comments.ts --after-id=evt_xyz --after-created-at=2025-01-15T10:30:00.000Z
 *
 * Options:
 *   --batch-size=N           Number of events to fetch per batch (default: 1000)
 *   --concurrency=N          Number of concurrent enqueues per batch (default: 16)
 *   --limit=N                Maximum number of events to process (default: unlimited)
 *   --after-id=ID            Resume after this event ID (cursor pagination)
 *   --after-created-at=ISO   Resume after this timestamp (ISO 8601)
 *   --dry-run                Show what would be processed without making changes
 */

import * as Sentry from "@sentry/node";
import pLimit from "p-limit";

import prisma from "@/lib/db/prisma";
import { sourceImportService } from "@/services/source-import.service";

interface BackfillOptions {
  batchSize: number;
  concurrency: number;
  limit?: number;
  afterId?: string;
  afterCreatedAt?: Date;
  dryRun: boolean;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    batchSize: 1000,
    concurrency: 16,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number.parseInt(arg.split("=")[1] ?? "1000", 10);
    } else if (arg.startsWith("--concurrency=")) {
      options.concurrency = Number.parseInt(arg.split("=")[1] ?? "16", 10);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.split("=")[1] ?? "0", 10);
    } else if (arg.startsWith("--after-id=")) {
      options.afterId = arg.split("=")[1];
    } else if (arg.startsWith("--after-created-at=")) {
      const dateStr = arg.split("=")[1];
      options.afterCreatedAt = dateStr ? new Date(dateStr) : undefined;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: tsx apps/core/scripts/backfill-task-event-comments.ts [options]

Options:
  --batch-size=N           Number of events to fetch per batch (default: 1000)
  --concurrency=N          Number of concurrent enqueues per batch (default: 16)
  --limit=N                Maximum number of events to process (default: unlimited)
  --after-id=ID            Resume after this event ID (cursor pagination)
  --after-created-at=ISO   Resume after this timestamp (ISO 8601)
  --dry-run                Show what would be processed without making changes
  --help, -h               Show this help message

Examples:
  # Dry-run preview
  tsx apps/core/scripts/backfill-task-event-comments.ts --dry-run --limit=1000

  # Full run with custom concurrency (match DATABASE_URL connection_limit)
  tsx apps/core/scripts/backfill-task-event-comments.ts --concurrency=16

  # Resume from checkpoint
  tsx apps/core/scripts/backfill-task-event-comments.ts --after-id=evt_xyz --after-created-at=2025-01-15T10:30:00.000Z
      `);
      process.exit(0);
    }
  }

  return options;
}

async function backfillTaskEventComments(
  options: BackfillOptions,
): Promise<number> {
  const { batchSize, concurrency, limit, afterId, afterCreatedAt, dryRun } =
    options;
  let processedCount = 0;
  let cursorId: string | undefined = afterId;
  let cursorCreatedAt: Date | undefined = afterCreatedAt;

  console.log(
    `Starting backfill (batch=${batchSize}, concurrency=${concurrency}, limit=${limit ?? "unlimited"}, dryRun=${dryRun}, cursor=${cursorId ? `${cursorCreatedAt?.toISOString()}/${cursorId}` : "start"})`,
  );

  while (true) {
    // Stop if limit is reached
    if (limit !== undefined && processedCount >= limit) {
      console.log(`Reached limit of ${limit} events`);
      break;
    }

    const remainingLimit =
      limit !== undefined ? limit - processedCount : undefined;
    const effectiveTake =
      remainingLimit !== undefined
        ? Math.min(batchSize, remainingLimit)
        : batchSize;

    // Build where clause for cursor-based pagination
    const where: {
      comment: { not: null };
      OR?: Array<{
        createdAt: { gt: Date } | Date;
        id?: { gt: string };
      }>;
    } = {
      comment: { not: null },
    };

    // Continue from last cursor using (createdAt, id) for stable ordering
    if (cursorId && cursorCreatedAt) {
      where.OR = [
        { createdAt: { gt: cursorCreatedAt } },
        { createdAt: cursorCreatedAt, id: { gt: cursorId } },
      ];
    }

    // Fetch events with stable ordering (createdAt, id)
    const events = await prisma.taskEvent.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        taskId: true,
        comment: true,
        createdAt: true,
      },
      take: effectiveTake,
    });

    if (events.length === 0) {
      console.log("No more events to process");
      break;
    }

    const batchStartTime = Date.now();
    console.log(
      `Processing batch of ${events.length} events (concurrency=${concurrency}, cursor=${cursorId ?? "start"})`,
    );

    // Process events concurrently with a concurrency limit
    const limitFn = pLimit(concurrency);
    const tasks = events.map((event) =>
      limitFn(async () => {
        if (!event.comment) {
          return;
        }

        try {
          if (dryRun) {
            // In dry-run, don't log comment bodies
            console.log(
              `[DRY RUN] Would process TaskEvent ${event.id} (task=${event.taskId}, created=${event.createdAt.toISOString()})`,
            );
          } else {
            // Pass the regular prisma client instead of wrapping in a transaction
            await sourceImportService.enqueueTaskOutputsFromMarkdown(
              event.taskId,
              event.comment,
              prisma,
            );
          }
        } catch (error) {
          // Log but continue - individual failures shouldn't stop the batch
          console.error(
            `Failed to backfill TaskEvent ${event.id} (task=${event.taskId}):`,
            error instanceof Error ? error.message : String(error),
          );
          Sentry.captureException(error, {
            extra: {
              taskEventId: event.id,
              taskId: event.taskId,
            },
          });
        }
      }),
    );

    // Wait for all tasks in the batch to complete
    await Promise.allSettled(tasks);

    processedCount += events.length;
    const lastEvent = events[events.length - 1];
    const batchDuration = Date.now() - batchStartTime;

    if (lastEvent) {
      cursorId = lastEvent.id;
      cursorCreatedAt = lastEvent.createdAt;
      const eventsPerSec = Math.round((events.length / batchDuration) * 1000);
      console.log(
        `Processed ${processedCount} events so far (${batchDuration}ms, ~${eventsPerSec}/s) | Last: ${lastEvent.id} @ ${lastEvent.createdAt.toISOString()}`,
      );
    }

    // If we got fewer than requested, we've reached the end
    if (events.length < effectiveTake) {
      break;
    }
  }

  return processedCount;
}

async function main() {
  const options = parseArgs();

  try {
    const startTime = Date.now();
    const processedCount = await backfillTaskEventComments(options);
    const durationMs = Date.now() - startTime;

    console.log(`
Backfill complete!
  Processed: ${processedCount} events
  Duration: ${durationMs}ms
  Mode: ${options.dryRun ? "DRY RUN" : "LIVE"}
    `);

    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    Sentry.captureException(error);
    process.exit(1);
  }
}

main();
