import * as Sentry from "@sentry/node";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import {
  type JobWithSokosumiStatus,
  jobInclude,
} from "@sokosumi/database/types/job";
import type { MasumiPurchaseDiffEntry } from "@sokosumi/masumi/clients";

import { paymentClient } from "@/clients/masumi-payment.client";
import { doesPurchaseMatchJobTerms } from "@/helpers/purchase";
import prisma from "@/lib/db/prisma";
import { createCoreLogger, emitCoreError, emitCoreWarning } from "@/lib/evlog";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

/**
 * Cursor key for the purchase diff feed. Versioned like the registry cursor
 * (see AGENTS_SYNC_METADATA_KEY): bump the suffix whenever already-applied
 * purchases must be replayed, so an old binary cannot advance the new cursor
 * during a rolling deployment.
 */
export const PURCHASE_DIFF_SYNC_METADATA_KEY = "purchase-diff-sync:v2";

/**
 * Rows per diff request. The run deadline, not this number, bounds a run: a
 * smaller page costs more requests to drain the same backlog, never fewer
 * rows. Held low so one response stays small for whatever serves it. The node
 * sits behind a proxy that answers 521 when the origin is not there.
 */
export const PURCHASE_DIFF_PAGE_SIZE = 20;

/**
 * How far back the FIRST run reaches when no cursor exists yet.
 *
 * Not the epoch: replaying the node's whole history would re-apply terminal
 * states to jobs that finished months ago, and a status that moves fires
 * completion or failure emails, the failure webhook, and an Ably publish. 30
 * days is the window this repo already treats as "still worth syncing" for
 * offline agents (FREE_JOB_OFFLINE_SYNC_WINDOW_MS), and it comfortably covers
 * every deadline a live purchase can still be waiting on. An operator who
 * wants the full history asks for it with `GET /sync/jobs?replay=true`.
 */
export const PURCHASE_DIFF_INITIAL_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * How far BEFORE the stored cursor each run restarts.
 *
 * `lastUpdate` filters on a timestamp the node stamps when the change is made,
 * but a row becomes visible to us when its transaction commits. A change
 * stamped 12:00:03.100 that commits after we have already read past
 * 12:00:03.400 would never be served again, and the per-job poll that used to
 * re-read every open job each tick is gone. Re-reading a few minutes of
 * already-applied rows costs one no-op write each: finalizeJobSyncResult
 * returns early when the job status did not change, so nothing is re-notified.
 *
 * VERIFIED 2026-09-01: the payment service trigger uses transaction-start
 * CURRENT_TIMESTAMP. A run therefore advances its drained watermark only to
 * wall-clock time minus this window. A parked scan keeps its original horizon
 * across runs, so the next overlap starts where that scan proved completeness.
 */
export const PURCHASE_DIFF_REREAD_WINDOW_MS = 1000 * 60 * 5;

const PURCHASE_DIFF_REQUEST_TIMEOUT_MS = 10_000;

/** Names the purchase diff's events; it runs only inside the jobs cron. */
const PURCHASE_DIFF_OPERATION = "job_purchase_diff_sync";

/**
 * Kept off the request timeout so a request started just before the deadline
 * cannot run past it and eat the refund phase's reserve. Mirrors the buffer in
 * createPollingSignal (job-sync.service.ts).
 */
const PURCHASE_DIFF_TIMEOUT_BUFFER_MS = 250;

export interface PurchaseDiffSyncOptions {
  abortSignal: AbortSignal;
  /**
   * Applies one changed purchase to its job. A throw parks the cursor on the
   * previous row, so the failing purchase is retried on the next run.
   */
  applyPurchase: (
    job: JobWithSokosumiStatus,
    purchase: MasumiPurchaseDiffEntry,
  ) => Promise<void>;
  deadlineMs: number;
  /** Replays the whole feed from the beginning. */
  resetCursor?: boolean;
  shouldContinue: () => boolean;
}

export interface PurchaseDiffSyncResult {
  /** Diff rows read from the node, including rows that are not ours. */
  found: number;
  /** Rows that were applied to one of our jobs. */
  processed: number;
}

/** What a run did, for its one summary event. */
interface PurchaseDiffRun extends PurchaseDiffSyncResult {
  cursorReset: boolean;
  /** Where the run stopped early; null when it did not. */
  stopped: string | null;
}

interface PurchaseDiffCursor {
  changedAt: Date;
  id: string;
}

interface PersistedPurchaseDiffCursor {
  changedAt: string;
  cursorId: string | null;
  stableThrough: string;
  version: 1;
}

function shouldStop(
  options: PurchaseDiffSyncOptions,
  run: PurchaseDiffRun,
  message: string,
  allowExpiredDeadline = false,
): boolean {
  if (options.abortSignal.aborted) {
    run.stopped = `${message} (aborted)`;
    return true;
  }
  if (
    !options.shouldContinue() ||
    (!allowExpiredDeadline && Date.now() >= options.deadlineMs)
  ) {
    run.stopped = `${message} (out of budget)`;
    return true;
  }
  return false;
}

/**
 * Jobs owning the given diff rows, keyed by the node's purchase id.
 *
 * `JobPurchase.externalId` holds exactly that id and is unique, so the primary
 * lookup is an id join. The fallback covers the one case the id join cannot:
 * the node replaced the purchase row, so our stored id is stale. `Job.
 * blockchainIdentifier` is unique and is the key the per-job poll used before
 * this feed replaced it, so it still finds the job. The update writes the fresh
 * `externalId` back, so the drift repairs itself.
 *
 * The fallback deliberately only reaches jobs that ALREADY have a purchase
 * row. Attaching a purchase to a job that has none is the backfill phase's
 * job, and it does that behind a full terms check (input hash, seller vkey,
 * agent identifier, amounts, deadlines).
 */
async function getJobsForDiffPurchases(
  purchases: MasumiPurchaseDiffEntry[],
  claimedJobIds: Set<string>,
): Promise<Map<string, JobWithSokosumiStatus>> {
  const rows = await prisma.jobPurchase.findMany({
    where: { externalId: { in: purchases.map((purchase) => purchase.id) } },
    include: { job: { include: jobInclude } },
  });
  const jobsByPurchaseId = new Map(
    rows.map((row) => [row.externalId, mapJobWithStatus(row.job)]),
  );

  // One job takes at most one FALLBACK row per run, pages included. Two rows
  // sharing an identifier would otherwise both apply, and the job's status
  // would flip between them on every run of the re-read window, re-firing its
  // emails and webhook each time. Claimed before the early return below: a
  // page where every row matched by id still claims its jobs against the
  // fallback on a LATER page.
  for (const job of jobsByPurchaseId.values()) {
    claimedJobIds.add(job.id);
  }

  const unmatched = purchases.filter(
    (purchase) => !jobsByPurchaseId.has(purchase.id),
  );
  const identifiers = unmatched
    .map((purchase) => purchase.blockchainIdentifier)
    .filter((identifier): identifier is string => Boolean(identifier));
  if (identifiers.length === 0) {
    return jobsByPurchaseId;
  }

  const rowsByIdentifier = await prisma.jobPurchase.findMany({
    where: {
      job: {
        blockchainIdentifier: { in: identifiers, mode: "insensitive" },
      },
    },
    include: { job: { include: jobInclude } },
  });
  const jobsByIdentifier = new Map<string, JobWithSokosumiStatus[]>();
  for (const row of rowsByIdentifier) {
    const identifier = row.job.blockchainIdentifier?.toLowerCase();
    if (!identifier) {
      continue;
    }
    const jobs = jobsByIdentifier.get(identifier) ?? [];
    jobs.push(mapJobWithStatus(row.job));
    jobsByIdentifier.set(identifier, jobs);
  }
  for (const purchase of unmatched) {
    const candidates =
      jobsByIdentifier
        .get(purchase.blockchainIdentifier.toLowerCase())
        ?.filter((job) => !claimedJobIds.has(job.id)) ?? [];
    if (candidates.length === 0) {
      continue;
    }
    const matchingJobs = candidates.filter((job) =>
      doesPurchaseMatchJobTerms(purchase, job),
    );
    if (matchingJobs.length !== 1) {
      const fallbackError = new Error(
        matchingJobs.length === 0
          ? `Purchase ${purchase.id} matches a job blockchain identifier but not its durable terms`
          : `Purchase ${purchase.id} ambiguously matches ${matchingJobs.length} jobs by blockchain identifier and durable terms`,
      );
      emitCoreError(
        {
          operation: PURCHASE_DIFF_OPERATION,
          purchase: { id: purchase.id },
          candidateJobIds: candidates.map((job) => job.id),
          matchingJobCount: matchingJobs.length,
        },
        {
          message:
            "Refused to attach a changed purchase to a job found by its blockchain identifier",
          why:
            matchingJobs.length === 0
              ? "The purchase shares the job's blockchain identifier but not its durable terms"
              : "The purchase matches more than one job by blockchain identifier and durable terms",
          fix: "Compare the purchase on the payment node with the candidate jobs (Sentry has the same error). The jobs keep their stored purchase until it is resolved.",
        },
      );
      Sentry.captureException(fallbackError);
      continue;
    }
    const job = matchingJobs[0];
    if (job === undefined) {
      continue;
    }
    emitCoreWarning(
      {
        operation: PURCHASE_DIFF_OPERATION,
        purchase: { id: purchase.id },
        job: { id: job.id },
      },
      {
        message:
          "Matched a changed purchase to its job by blockchain identifier",
        why: "The job's stored purchase id is stale: the payment node replaced the purchase row",
        fix: "Nothing to do: the update writes the new purchase id back to the job.",
      },
    );
    claimedJobIds.add(job.id);
    jobsByPurchaseId.set(purchase.id, job);
  }
  return jobsByPurchaseId;
}

/**
 * The node answered with a purchase whose blockchain identifier is not the
 * one this job was created for. The id join says the row is ours, so a
 * mismatch is corruption on one side or the other, never a routine miss.
 */
function isDiffPurchaseForeign(
  purchase: MasumiPurchaseDiffEntry,
  job: JobWithSokosumiStatus,
): boolean {
  // An absent identifier on either side reads as unverifiable, not foreign.
  // The node's own contract types the purchase side as a required string, so
  // that half is belt-and-braces; `Job.blockchainIdentifier` really is
  // nullable. The externalId join already established that this row is this
  // job's purchase, so refusing here would strand the job instead of
  // protecting it.
  if (
    typeof purchase.blockchainIdentifier !== "string" ||
    purchase.blockchainIdentifier.length === 0 ||
    typeof job.blockchainIdentifier !== "string" ||
    job.blockchainIdentifier.length === 0
  ) {
    return false;
  }
  // Casing never carries meaning in these hex-encoded protocol values.
  return (
    purchase.blockchainIdentifier.toLowerCase() !==
    job.blockchainIdentifier.toLowerCase()
  );
}

/**
 * Where a run begins. `lastSyncedAt` is always the safe watermark. `cursorId`
 * is an opaque active-scan state with its page cursor and fixed time horizon.
 * Keeping them separate prevents an interrupted forward scan from moving the
 * safe watermark past a transaction that committed behind its page cursor.
 */
interface PurchaseDiffCursorStart {
  changedAt: Date;
  cursorId: string | null;
  safeWatermark: Date;
  stableThrough: Date;
}

function parsePersistedCursor(
  encodedCursor: string,
): Omit<PurchaseDiffCursorStart, "safeWatermark"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedCursor);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== 1 ||
    typeof value.changedAt !== "string" ||
    (value.cursorId !== null && typeof value.cursorId !== "string") ||
    typeof value.stableThrough !== "string"
  ) {
    return null;
  }
  const changedAt = new Date(value.changedAt);
  const stableThrough = new Date(value.stableThrough);
  if (
    Number.isNaN(changedAt.getTime()) ||
    Number.isNaN(stableThrough.getTime()) ||
    changedAt.getTime() > stableThrough.getTime()
  ) {
    return null;
  }
  return {
    changedAt,
    cursorId: value.cursorId,
    stableThrough,
  };
}

function encodePersistedCursor(
  cursor: { changedAt: Date; id: string | null },
  stableThrough: Date,
): string {
  const persistedCursor: PersistedPurchaseDiffCursor = {
    changedAt: cursor.changedAt.toISOString(),
    cursorId: cursor.id,
    stableThrough: stableThrough.toISOString(),
    version: 1,
  };
  return JSON.stringify(persistedCursor);
}

async function readCursor(
  options: PurchaseDiffSyncOptions,
  run: PurchaseDiffRun,
  stableThrough: Date,
): Promise<PurchaseDiffCursorStart> {
  if (options.resetCursor) {
    const replayStart = new Date(0);
    await prisma.syncMetadata.upsert({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: replayStart,
      },
      update: { cursorId: null, lastSyncedAt: replayStart },
    });
    // Cursor reset requested: replaying the full purchase diff.
    run.cursorReset = true;
    return {
      changedAt: replayStart,
      cursorId: null,
      safeWatermark: replayStart,
      stableThrough,
    };
  }

  const metadata = await prisma.syncMetadata.findUnique({
    where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
  });
  if (!metadata) {
    const initialStart = new Date(
      Date.now() - PURCHASE_DIFF_INITIAL_LOOKBACK_MS,
    );
    await prisma.syncMetadata.upsert({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      create: {
        key: PURCHASE_DIFF_SYNC_METADATA_KEY,
        cursorId: null,
        lastSyncedAt: initialStart,
      },
      update: { cursorId: null, lastSyncedAt: initialStart },
    });
    return {
      changedAt: initialStart,
      cursorId: null,
      safeWatermark: initialStart,
      stableThrough,
    };
  }
  if (metadata.cursorId !== null) {
    const persistedCursor = parsePersistedCursor(metadata.cursorId);
    if (persistedCursor !== null) {
      return {
        ...persistedCursor,
        safeWatermark: metadata.lastSyncedAt,
      };
    }
    const invalidCursorError = new Error(
      "Stored purchase diff cursor state is invalid; restarting from the safe watermark",
    );
    emitCoreError(
      {
        operation: PURCHASE_DIFF_OPERATION,
        syncMetadata: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      },
      {
        message:
          "The stored purchase diff cursor is invalid, so the run restarts from the safe watermark",
        why: "The stored cursor state is not a version 1 cursor with valid dates",
        fix: "Nothing to do for one run: the diff re-reads from the watermark. If it recurs, find what writes this sync metadata key.",
      },
    );
    Sentry.captureException(invalidCursorError);
    await prisma.syncMetadata.updateMany({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
      data: { cursorId: null },
    });
  }
  return {
    changedAt: new Date(
      Math.max(
        0,
        metadata.lastSyncedAt.getTime() - PURCHASE_DIFF_REREAD_WINDOW_MS,
      ),
    ),
    cursorId: null,
    safeWatermark: metadata.lastSyncedAt,
    stableThrough,
  };
}

/** Stores active scan progress without moving the safe watermark. */
async function persistCursor(
  safeWatermark: Date,
  cursor: { changedAt: Date; id: string | null },
  stableThrough: Date,
): Promise<void> {
  const encodedCursor = encodePersistedCursor(cursor, stableThrough);
  await prisma.syncMetadata.upsert({
    where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
    create: {
      key: PURCHASE_DIFF_SYNC_METADATA_KEY,
      cursorId: encodedCursor,
      lastSyncedAt: safeWatermark,
    },
    update: {
      cursorId: encodedCursor,
      lastSyncedAt: safeWatermark,
    },
  });
}

/**
 * Clears the resume point once a run reaches its safe time horizon. Moving the
 * watermark to that horizon keeps normal empty runs cheap and arms the re-read
 * window for the next run. `updateMany` because readCursor always creates the
 * metadata row before a request.
 */
async function markCursorDrained(stableThrough: Date): Promise<void> {
  await prisma.syncMetadata.updateMany({
    where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
    data: { cursorId: null, lastSyncedAt: stableThrough },
  });
}

/**
 * Null when there is no useful time left, so the run stops instead of issuing
 * a request that aborts on arrival. Same shape as createPollingSignal
 * (job-sync.service.ts).
 */
function createRequestSignal(
  options: PurchaseDiffSyncOptions,
): AbortSignal | null {
  const remainingMs =
    options.deadlineMs - Date.now() - PURCHASE_DIFF_TIMEOUT_BUFFER_MS;
  if (remainingMs <= 0) {
    return null;
  }
  return AbortSignal.any([
    options.abortSignal,
    AbortSignal.timeout(
      Math.min(remainingMs, PURCHASE_DIFF_REQUEST_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Pulls the purchases that changed since the stored cursor and applies each to
 * its job. One request per page replaces one request per unfinished job, so a
 * run costs what actually changed on the node rather than what is open here.
 *
 * The cursor only ever advances over a contiguous prefix of handled rows: a
 * row that fails to apply stops the run with the cursor parked in front of it,
 * exactly like the registry sync (agent-sync.service.ts). A row that keeps
 * failing therefore keeps the feed parked rather than being dropped silently,
 * which is that file's stated trade-off too, and anything outside the known
 * transient classes pages on the first failure.
 */
export async function syncPurchasesFromDiff(
  options: PurchaseDiffSyncOptions,
): Promise<PurchaseDiffSyncResult> {
  // Runs after the jobs cron response: the run is one standalone event with
  // its counts and where it stopped early. Failures are their own events.
  const run: PurchaseDiffRun = {
    found: 0,
    processed: 0,
    cursorReset: false,
    stopped: null,
  };
  const log = createCoreLogger({ operation: PURCHASE_DIFF_OPERATION });
  try {
    await runPurchaseDiff(options, run);
  } finally {
    log.set({ purchaseDiff: run });
    log.emit();
  }
  return { found: run.found, processed: run.processed };
}

async function runPurchaseDiff(
  options: PurchaseDiffSyncOptions,
  run: PurchaseDiffRun,
): Promise<void> {
  const startedAt = Date.now();
  const nextStableThrough = new Date(
    startedAt - PURCHASE_DIFF_REREAD_WINDOW_MS,
  );
  if (
    shouldStop(
      options,
      run,
      options.resetCursor
        ? "Stopping before resetting the diff cursor"
        : "Stopping before reading the diff cursor",
      options.resetCursor === true,
    )
  ) {
    return;
  }
  const cursorStart = await readCursor(options, run, nextStableThrough);
  const { safeWatermark, stableThrough } = cursorStart;
  let { changedAt, cursorId } = cursorStart;
  const claimedJobIds = new Set<string>();
  let drained = false;

  while (true) {
    if (shouldStop(options, run, "Stopping before the next diff request")) {
      break;
    }

    const signal = createRequestSignal(options);
    if (signal === null) {
      run.stopped = "Stopping before the next diff request (no time left)";
      break;
    }

    const requestChangedAt = changedAt;
    const requestCursorId = cursorId;
    const purchasesResult = await paymentClient().getPurchasesDiff(
      changedAt,
      cursorId,
      PURCHASE_DIFF_PAGE_SIZE,
      { signal },
    );
    if (
      signal.aborted &&
      (options.abortSignal.aborted ||
        Date.now() >= options.deadlineMs - PURCHASE_DIFF_TIMEOUT_BUFFER_MS)
    ) {
      run.stopped = "Stopping after the diff request (aborted)";
      break;
    }
    if (purchasesResult.isErr()) {
      // The diff is the only path that updates a job whose purchase row
      // already exists, so a request that keeps failing (an expired API key,
      // say) freezes purchase state everywhere. Page when the node supplied
      // its own error envelope. A retryable proxy response gets one warning.
      // The cursor stays parked either way, so the feed resumes where it was.
      const { hasNodeErrorEnvelope, message, status } = purchasesResult.error;
      const error = Object.assign(new Error(message), { statusCode: status });
      if (hasNodeErrorEnvelope) {
        Sentry.captureException(error);
      } else {
        // Safe fields and the status only: without the node's envelope the
        // message is whatever the proxy answered, stringified.
        captureExternalServiceError(error, {
          label: "sync/jobs/purchase-diff",
        });
      }
      break;
    }

    const purchases = purchasesResult.value;
    if (purchases.length === 0) {
      drained = true;
      break;
    }
    run.found += purchases.length;

    const stablePurchases = purchases.filter(
      (purchase) =>
        purchase.nextActionOrOnChainStateOrResultLastChangedAt.getTime() <=
        stableThrough.getTime(),
    );
    const reachedStableHorizon = stablePurchases.length < purchases.length;
    if (stablePurchases.length === 0) {
      drained = true;
      break;
    }

    const purchasesToHandle = stablePurchases.filter(
      (purchase) =>
        requestCursorId === null ||
        purchase.id !== requestCursorId ||
        purchase.nextActionOrOnChainStateOrResultLastChangedAt.getTime() !==
          requestChangedAt.getTime(),
    );
    const jobsByPurchaseId = await getJobsForDiffPurchases(
      purchasesToHandle,
      claimedJobIds,
    );

    let lastHandledCursor: PurchaseDiffCursor | null = null;
    let stopAfterThisPage = false;

    for (const purchase of stablePurchases) {
      const purchaseCursor = {
        changedAt: purchase.nextActionOrOnChainStateOrResultLastChangedAt,
        id: purchase.id,
      };
      if (
        requestCursorId !== null &&
        purchase.id === requestCursorId &&
        purchaseCursor.changedAt.getTime() === requestChangedAt.getTime()
      ) {
        lastHandledCursor = purchaseCursor;
        continue;
      }
      if (shouldStop(options, run, `Stopping before purchase ${purchase.id}`)) {
        stopAfterThisPage = true;
        break;
      }

      const job = jobsByPurchaseId.get(purchase.id);
      if (job === undefined) {
        // Another API-key consumer's purchase, or one of ours that has no job
        // row yet. The backfill phase owns the second case.
        lastHandledCursor = purchaseCursor;
        continue;
      }

      if (isDiffPurchaseForeign(purchase, job)) {
        const foreignPurchaseError = new Error(
          `Diff purchase is for a different blockchain identifier than job ${job.id}; refusing purchase state update`,
        );
        emitCoreError(
          {
            operation: PURCHASE_DIFF_OPERATION,
            job: { id: job.id, blockchainIdentifier: job.blockchainIdentifier },
            purchase: {
              id: purchase.id,
              blockchainIdentifier: purchase.blockchainIdentifier,
            },
          },
          {
            message:
              "Refused to apply a changed purchase to its job, because their blockchain identifiers differ",
            why: "The stored purchase id joins the purchase to this job, but the purchase is for another blockchain identifier",
            fix: "Check the job's purchase row against the payment node's purchase (Sentry has the same error): one side is corrupt. The diff moves past this row.",
          },
        );
        Sentry.captureException(foreignPurchaseError);
        lastHandledCursor = purchaseCursor;
        continue;
      }

      try {
        await options.applyPurchase(job, purchase);
        run.processed++;
      } catch (error) {
        // Park the cursor in front of this row so the next run retries it.
        emitCoreError(
          {
            operation: PURCHASE_DIFF_OPERATION,
            purchase: { id: purchase.id },
            job: { id: job.id },
          },
          {
            message: "Could not apply a changed purchase to its job",
            why: "Writing the purchase state to the job failed",
            fix: "The diff stays parked in front of this purchase, so the next jobs sync retries it. If it fails every run, Sentry has the error.",
          },
          // Only safe fields: the write carries the provider's free-text
          // error note, and a Prisma validation error quotes what it writes.
          { failure: messageSafeErrorFields(error) },
        );
        // Transient Prisma classes (write conflict, pool timeout) self-heal on
        // the next run and would otherwise page on every cron tick; a real
        // bug is not in that set and still pages.
        captureExternalServiceError(error, {
          label: "sync/jobs/purchase-diff",
          extra: { jobId: job.id, purchaseId: purchase.id },
        });
        stopAfterThisPage = true;
        break;
      }

      lastHandledCursor = purchaseCursor;
    }

    if (lastHandledCursor !== null) {
      await persistCursor(safeWatermark, lastHandledCursor, stableThrough);
      // The node treats `lastUpdate` as inclusive and breaks ties on
      // `cursorId`, so a page that ends where the last one ended means the
      // cursor is not moving. Stop instead of re-reading (and re-applying)
      // the same rows until the deadline.
      const cursorStalled =
        lastHandledCursor.id === requestCursorId &&
        lastHandledCursor.changedAt.getTime() === requestChangedAt.getTime();
      changedAt = lastHandledCursor.changedAt;
      cursorId = lastHandledCursor.id;
      if (cursorStalled) {
        emitCoreWarning(
          {
            operation: PURCHASE_DIFF_OPERATION,
            purchaseDiffCursor: { id: cursorId },
          },
          {
            message:
              "The purchase diff cursor did not advance, so the run stopped",
            why: "The page ended on the same row as the previous page",
            fix: "The next jobs sync resumes from this row. If it stalls every run, check how the payment node pages its purchase diff.",
          },
        );
        // Only a page that ran to its end proves the feed has nothing past
        // this row. A page cut short by the budget or by a failed apply ends
        // on the resume row for a different reason, and must keep its resume
        // point so the next run continues instead of rewinding.
        drained = !stopAfterThisPage;
        break;
      }
    }

    if (stopAfterThisPage) {
      break;
    }
    if (reachedStableHorizon) {
      drained = true;
      break;
    }
    if (purchases.length < PURCHASE_DIFF_PAGE_SIZE) {
      drained = true;
      break;
    }
  }

  if (drained) {
    await markCursorDrained(stableThrough);
  }
}
