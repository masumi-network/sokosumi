import { waitUntil } from "@vercel/functions";

import {
  type FileIndexSyncResult,
  processFileIndexJobs,
} from "@/services/file-index.service";

/**
 * Run pending index work inside the request that created it.
 *
 * Vercel runs crons on production deployments only, so on a preview the
 * `/sync/drive-index` cron never fires and an uploaded file would sit
 * unindexed forever. The same nudge is harmless in production: the job lease
 * makes a duplicate runner a no-op, and the cron stays the reliable sweeper
 * for anything this misses.
 */

/** Small: this shares a request's budget with the response the reader wants. */
const IN_PROCESS_JOB_LIMIT = 5;
const IN_PROCESS_BUDGET_MS = 20_000;

export function nudgeFileIndexing(): void {
  waitUntil(runIndexingNudge());
}

export async function runIndexingNudge(): Promise<FileIndexSyncResult> {
  const deadline = Date.now() + IN_PROCESS_BUDGET_MS;
  try {
    return await processFileIndexJobs({
      shouldContinue: () => Date.now() < deadline,
      maxJobs: IN_PROCESS_JOB_LIMIT,
    });
  } catch (error) {
    // Indexing is background work. It must never fail the upload, the
    // search or the page that happened to trigger it.
    console.warn("[files] in-process indexing nudge failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { processed: 0, indexed: 0, failed: 0 };
  }
}
