import { waitUntil } from "@vercel/functions";

import {
  type FileIndexSyncResult,
  processFileIndexJobs,
} from "@/services/file-index.service";
import {
  processFileSuggestionJobs,
  type SuggestionSyncResult,
} from "@/services/file-suggestions.service";

/**
 * Run pending index work inside the request that created it.
 *
 * Vercel runs crons on production deployments only, so on a preview the
 * `/sync/drive-index` cron never fires and an uploaded file would sit
 * unindexed forever. The same nudge is harmless in production: the job lease
 * makes a duplicate runner a no-op, and the cron stays the reliable sweeper
 * for anything this misses.
 *
 * ## Both halves of the pipeline, not one
 *
 * This drained extraction only, and the argument above applies to
 * suggestion word for word. The consequence was not a slower preview but a
 * dead feature: `file-index.service.ts` enqueues a SUGGEST job whenever
 * extraction produces chunks, `processFileSuggestionJobs` has exactly one
 * caller in the repository — the cron — and so on a preview those jobs
 * accumulated QUEUED and were never leased by anything.
 *
 * Categories and tags are the feature this branch is named for, and they
 * had therefore never executed end to end on any deployment. What made it
 * expensive to find is that the failure is silent by construction: a
 * document with no labels renders as "Uncategorized" and "No tags yet",
 * which is exactly what a document that was considered and found to warrant
 * neither would render as. The empty state cannot distinguish "nothing to
 * say" from "never ran".
 *
 * ## What this costs the reader: nothing, and that is the point of `waitUntil`
 *
 * Suggestion makes a paid Jev call per document, which would be an alarming
 * thing to put inside a user's request. It is not inside one. `waitUntil`
 * hands the work to the platform to finish *after* the response has been
 * flushed, so no reader waits on an evaluation and no search deadline moves.
 * The budgets below bound the function's lifetime, not anybody's latency.
 *
 * Spend is bounded where it was already bounded. Every evaluation still
 * passes `admitJevRequest` and the per-workspace daily ceiling, so this
 * opens no new hole in the cap; it changes when the spend happens, not how
 * much of it is allowed.
 *
 * ## Separate budgets, deliberately
 *
 * Extraction is local work — fetch bytes, parse, chunk. Suggestion is a
 * network round trip to a model. Sharing one budget would let a slow
 * extraction consume everything and leave suggestion exactly as dead as it
 * was, which is the failure being fixed. Each half gets its own clock and
 * its own job cap, and the suggestion cap is lower because each of its jobs
 * costs money rather than milliseconds.
 */

/** Small: these share a function's lifetime with real user work. */
const IN_PROCESS_JOB_LIMIT = 5;
const IN_PROCESS_BUDGET_MS = 20_000;

/**
 * Fewer jobs and a tighter clock than extraction.
 *
 * Three rather than five because each one is a paid model call, and a
 * single upload should not quietly work through a backlog on the spend of
 * whoever happened to trigger it. The cron remains the sweeper for the
 * rest.
 */
const IN_PROCESS_SUGGESTION_JOB_LIMIT = 3;
const IN_PROCESS_SUGGESTION_BUDGET_MS = 15_000;

export interface IndexingNudgeResult {
  extraction: FileIndexSyncResult;
  suggestion: SuggestionSyncResult;
}

/**
 * Both halves, for the paths where a reader asked for this document to be
 * processed: an upload, and an explicit reindex.
 *
 * ## One rule, three paths
 *
 * Whose request pays, and did they ask for it?
 *
 * - **Upload** (`files/finalize.ts`) — they asked for this document to
 *   exist, and a document without a category or tags is half-created.
 *   Both halves.
 * - **Reindex** (`resources/[id]/reindex`) — they pressed a button whose
 *   entire purpose is "process this again", usually because the labels
 *   came out wrong. Labelling is the thing being retried, so extraction
 *   alone would be a recovery path that recovers nothing. Both halves,
 *   behind that route's cooldown so it stays metered.
 * - **Search** (`drive/search`) — they asked to read. The backfill branch
 *   there adopts documents nobody mentioned, and charging a reader's
 *   request for evaluations on a backlog they did not ask about is the
 *   spend this module warns against two paragraphs down. Extraction only;
 *   see `nudgeFileExtraction`.
 *
 * Stated together because read as three separate decisions they look
 * arbitrary, and the next path added will be read against this list.
 */
export function nudgeFileIndexing(): void {
  waitUntil(runIndexingNudge());
}

/**
 * Extraction only. For read paths.
 *
 * `GET /v1/drive/search` also nudges, inside the
 * `isDriveStoreBackfillPending` branch, and the full nudge made a search
 * spend money: up to three paid label evaluations per request, on top of
 * the ranking calls the search itself makes. Backfill stays pending across
 * several visits by design — five listing pages each — so a large Drive
 * kept that branch live for many searches, and the spend belonged to
 * whoever happened to be searching.
 *
 * That is the same principle this module already states for uploads, one
 * path over: nobody should quietly work through a backlog on the spend of
 * a request that did not ask for it. A search asked to read.
 *
 * Extraction is kept because it is local work — fetch, parse, chunk, no
 * provider — and because this branch is exactly where documents are
 * adopted. Dropping it too would mean that on a preview, where no cron
 * runs, a freshly adopted document stays unindexed until somebody happens
 * to upload something. Labelling those documents is left to the upload
 * path and, in production, to the cron.
 */
export function nudgeFileExtraction(): void {
  waitUntil(runExtractionNudge());
}

const NO_SUGGESTIONS: SuggestionSyncResult = {
  processed: 0,
  suggested: 0,
  failed: 0,
  deferred: 0,
};

export async function runIndexingNudge(): Promise<IndexingNudgeResult> {
  const extraction = await runExtractionNudge();
  // Extraction first, and awaited: a document has to have text before
  // anything can have an opinion about its category. The same ordering the
  // cron uses.
  const suggestion = await runSuggestionNudge();
  return { extraction, suggestion };
}

export async function runExtractionNudge(): Promise<FileIndexSyncResult> {
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

async function runSuggestionNudge(): Promise<SuggestionSyncResult> {
  const deadline = Date.now() + IN_PROCESS_SUGGESTION_BUDGET_MS;
  try {
    return await processFileSuggestionJobs({
      shouldContinue: () => Date.now() < deadline,
      maxJobs: IN_PROCESS_SUGGESTION_JOB_LIMIT,
    });
  } catch (error) {
    // Caught separately from extraction on purpose. Folding them together
    // would mean a provider outage during labelling also reported
    // extraction as having done nothing, and the two have different
    // answers.
    console.warn("[files] in-process suggestion nudge failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ...NO_SUGGESTIONS };
  }
}
