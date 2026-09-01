import * as Sentry from "@sentry/node";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import {
  type JobWithSokosumiStatus,
  jobInclude,
} from "@sokosumi/database/types/job";
import type { MasumiPurchaseDiffEntry } from "@sokosumi/masumi/clients";

import { paymentClient } from "@/clients/masumi-payment.client";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";

/**
 * Cursor key for the purchase diff feed. Versioned like the registry cursor
 * (see AGENTS_SYNC_METADATA_KEY): bump the suffix whenever already-applied
 * purchases must be replayed, so an old binary cannot advance the new cursor
 * during a rolling deployment.
 */
export const PURCHASE_DIFF_SYNC_METADATA_KEY = "purchase-diff-sync:v1";

/** Rows per diff request. The run deadline, not this number, bounds a run. */
export const PURCHASE_DIFF_PAGE_SIZE = 50;

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
 */
export const PURCHASE_DIFF_REREAD_WINDOW_MS = 1000 * 60 * 5;

const PURCHASE_DIFF_REQUEST_TIMEOUT_MS = 10_000;

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

interface PurchaseDiffCursor {
  changedAt: Date;
  id: string;
}

function shouldStop(
  options: PurchaseDiffSyncOptions,
  message: string,
): boolean {
  if (options.abortSignal.aborted) {
    console.info(`[sync/jobs/purchase-diff] ${message} (aborted)`);
    return true;
  }
  if (!options.shouldContinue() || Date.now() >= options.deadlineMs) {
    console.info(`[sync/jobs/purchase-diff] ${message} (out of budget)`);
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
): Promise<Map<string, JobWithSokosumiStatus>> {
  const rows = await prisma.jobPurchase.findMany({
    where: { externalId: { in: purchases.map((purchase) => purchase.id) } },
    include: { job: { include: jobInclude } },
  });
  const jobsByPurchaseId = new Map(
    rows.map((row) => [row.externalId, mapJobWithStatus(row.job)]),
  );

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
    where: { job: { blockchainIdentifier: { in: identifiers } } },
    include: { job: { include: jobInclude } },
  });
  const jobsByIdentifier = new Map(
    rowsByIdentifier.map((row) => [
      row.job.blockchainIdentifier,
      mapJobWithStatus(row.job),
    ]),
  );
  for (const purchase of unmatched) {
    const job = jobsByIdentifier.get(purchase.blockchainIdentifier);
    if (job) {
      console.warn(
        `[sync/jobs/purchase-diff] Purchase ${purchase.id} matched job ${job.id} by blockchain identifier; stored externalId was stale`,
      );
      jobsByPurchaseId.set(purchase.id, job);
    }
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

async function readCursor(
  options: PurchaseDiffSyncOptions,
): Promise<{ changedAt: Date; cursorId: string | null }> {
  if (options.resetCursor) {
    await prisma.syncMetadata.deleteMany({
      where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
    });
    console.info(
      "[sync/jobs/purchase-diff] Cursor reset requested — replaying the full purchase diff",
    );
    return { changedAt: new Date(0), cursorId: null };
  }

  const metadata = await prisma.syncMetadata.findUnique({
    where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
  });
  if (!metadata) {
    return {
      changedAt: new Date(Date.now() - PURCHASE_DIFF_INITIAL_LOOKBACK_MS),
      cursorId: null,
    };
  }
  // The re-read window replaces the tie-breaker: it starts before the stored
  // timestamp, so the row the cursor id would have excluded comes back anyway.
  return {
    changedAt: new Date(
      metadata.lastSyncedAt.getTime() - PURCHASE_DIFF_REREAD_WINDOW_MS,
    ),
    cursorId: null,
  };
}

async function persistCursor(cursor: PurchaseDiffCursor): Promise<void> {
  await prisma.syncMetadata.upsert({
    where: { key: PURCHASE_DIFF_SYNC_METADATA_KEY },
    create: {
      key: PURCHASE_DIFF_SYNC_METADATA_KEY,
      cursorId: cursor.id,
      lastSyncedAt: cursor.changedAt,
    },
    update: {
      cursorId: cursor.id,
      lastSyncedAt: cursor.changedAt,
    },
  });
}

function createRequestSignal(options: PurchaseDiffSyncOptions): AbortSignal {
  const remainingMs =
    options.deadlineMs - Date.now() - PURCHASE_DIFF_TIMEOUT_BUFFER_MS;
  return AbortSignal.any([
    options.abortSignal,
    AbortSignal.timeout(
      Math.max(0, Math.min(remainingMs, PURCHASE_DIFF_REQUEST_TIMEOUT_MS)),
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
 * failing therefore keeps the feed parked and pages through Sentry rather than
 * being dropped silently, which is that file's stated trade-off too.
 */
export async function syncPurchasesFromDiff(
  options: PurchaseDiffSyncOptions,
): Promise<PurchaseDiffSyncResult> {
  const startedAt = Date.now();
  let { changedAt, cursorId } = await readCursor(options);
  let found = 0;
  let processed = 0;

  while (true) {
    if (shouldStop(options, "Stopping before the next diff request")) {
      break;
    }

    const purchasesResult = await paymentClient().getPurchasesDiff(
      changedAt,
      cursorId,
      PURCHASE_DIFF_PAGE_SIZE,
      { signal: createRequestSignal(options) },
    );
    if (purchasesResult.isErr()) {
      // The diff is the only path that updates a job whose purchase row
      // already exists, so a request that keeps failing (an expired API key,
      // a node outage) freezes purchase state everywhere. Page for it.
      console.error(
        "[sync/jobs/purchase-diff] Diff request failed; cursor not advanced:",
        purchasesResult.error,
      );
      captureExternalServiceError(new Error(purchasesResult.error), {
        label: "sync/jobs/purchase-diff",
      });
      break;
    }

    const purchases = purchasesResult.value;
    if (purchases.length === 0) {
      break;
    }
    found += purchases.length;

    const jobsByPurchaseId = await getJobsForDiffPurchases(purchases);

    let lastHandledCursor: PurchaseDiffCursor | null = null;
    let stopAfterThisPage = false;

    for (const purchase of purchases) {
      if (shouldStop(options, `Stopping before purchase ${purchase.id}`)) {
        stopAfterThisPage = true;
        break;
      }

      const job = jobsByPurchaseId.get(purchase.id);
      if (job === undefined) {
        // Another API-key consumer's purchase, or one of ours that has no job
        // row yet. The backfill phase owns the second case.
        lastHandledCursor = {
          changedAt: purchase.nextActionOrOnChainStateOrResultLastChangedAt,
          id: purchase.id,
        };
        continue;
      }

      if (isDiffPurchaseForeign(purchase, job)) {
        const foreignPurchaseError = new Error(
          `Diff purchase is for a different blockchain identifier than job ${job.id}; refusing purchase state update`,
        );
        console.error(foreignPurchaseError.message, {
          jobId: job.id,
          jobBlockchainIdentifier: job.blockchainIdentifier,
          purchaseBlockchainIdentifier: purchase.blockchainIdentifier,
          purchaseId: purchase.id,
        });
        Sentry.captureException(foreignPurchaseError);
        lastHandledCursor = {
          changedAt: purchase.nextActionOrOnChainStateOrResultLastChangedAt,
          id: purchase.id,
        };
        continue;
      }

      try {
        await options.applyPurchase(job, purchase);
        processed++;
      } catch (error) {
        // Park the cursor in front of this row so the next run retries it.
        console.error(
          `[sync/jobs/purchase-diff] Failed to apply purchase ${purchase.id} to job ${job.id}:`,
          error,
        );
        Sentry.captureException(error);
        stopAfterThisPage = true;
        break;
      }

      lastHandledCursor = {
        changedAt: purchase.nextActionOrOnChainStateOrResultLastChangedAt,
        id: purchase.id,
      };
    }

    if (lastHandledCursor !== null) {
      await persistCursor(lastHandledCursor);
      // The node treats `lastUpdate` as inclusive and breaks ties on
      // `cursorId`, so a page that ends where the last one ended means the
      // cursor is not moving. Stop instead of re-reading (and re-applying)
      // the same rows until the deadline.
      const cursorStalled = lastHandledCursor.id === cursorId;
      changedAt = lastHandledCursor.changedAt;
      cursorId = lastHandledCursor.id;
      if (cursorStalled) {
        console.warn(
          `[sync/jobs/purchase-diff] Cursor did not advance past ${cursorId}; stopping this run`,
        );
        break;
      }
    }

    if (stopAfterThisPage || purchases.length < PURCHASE_DIFF_PAGE_SIZE) {
      break;
    }
  }

  console.info(
    `[sync/jobs/purchase-diff] Completed purchase diff (found=${found}, processed=${processed}, durationMs=${Date.now() - startedAt})`,
  );
  return { found, processed };
}
