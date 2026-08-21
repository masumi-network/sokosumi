#!/usr/bin/env tsx
/**
 * One-shot backfill script for historical TaskEvent comments.
 *
 * Scans TaskEvent.comment (never Task.description) and enqueues PENDING
 * TASK_OUTPUT TaskFiles for file-like URLs. Idempotent on (taskId, sourceUrl).
 * Does not reset FAILED rows. Safe to re-run.
 *
 * Usage:
 *   tsx apps/core/scripts/backfill-task-event-comments.ts [--batch-size=N] [--limit=N]
 *
 * Options:
 *   --batch-size=N  Number of events to process per batch (default: 100)
 *   --limit=N       Maximum number of events to process (default: unlimited)
 *   --dry-run       Show what would be processed without making changes
 */

import * as Sentry from "@sentry/node";

import prisma from "@/lib/db/prisma";
import { sourceImportService } from "@/services/source-import.service";

interface BackfillOptions {
  batchSize: number;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    batchSize: 100,
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number.parseInt(arg.split("=")[1] ?? "100", 10);
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.split("=")[1] ?? "0", 10);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: tsx apps/core/scripts/backfill-task-event-comments.ts [options]

Options:
  --batch-size=N  Number of events to process per batch (default: 100)
  --limit=N       Maximum number of events to process (default: unlimited)
  --dry-run       Show what would be processed without making changes
  --help, -h      Show this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

async function backfillTaskEventComments(
  options: BackfillOptions,
): Promise<number> {
  const { batchSize, limit, dryRun } = options;
  let processedCount = 0;

  console.log(
    `Starting backfill (batch=${batchSize}, limit=${limit ?? "unlimited"}, dryRun=${dryRun})`,
  );

  while (true) {
    // Stop if limit is reached
    if (limit !== undefined && processedCount >= limit) {
      console.log(`Reached limit of ${limit} events`);
      break;
    }

    // Fetch a batch of task events with comments, oldest first
    const events = await prisma.taskEvent.findMany({
      where: {
        comment: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        taskId: true,
        comment: true,
        createdAt: true,
      },
      take: batchSize,
      skip: processedCount,
    });

    if (events.length === 0) {
      console.log("No more events to process");
      break;
    }

    console.log(
      `Processing batch of ${events.length} events (offset=${processedCount})`,
    );

    for (const event of events) {
      if (!event.comment) {
        continue;
      }

      try {
        if (dryRun) {
          console.log(
            `[DRY RUN] Would process TaskEvent ${event.id} (task=${event.taskId}, created=${event.createdAt.toISOString()})`,
          );
        } else {
          // Use a transaction to ensure atomicity
          await prisma.$transaction(async (tx) => {
            await sourceImportService.enqueueTaskOutputsFromMarkdown(
              event.taskId,
              event.comment as string,
              tx,
            );
          });
        }
      } catch (error) {
        // Log but continue - individual failures shouldn't stop the batch
        console.error(`Failed to backfill TaskEvent ${event.id}:`, error);
        Sentry.captureException(error, {
          extra: {
            taskEventId: event.id,
            taskId: event.taskId,
          },
        });
      }
    }

    processedCount += events.length;
    console.log(`Processed ${processedCount} events so far`);

    // If we got fewer than batchSize, we've reached the end
    if (events.length < batchSize) {
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
