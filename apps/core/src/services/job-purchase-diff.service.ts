import * as Sentry from "@sentry/node";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import {
  type JobWithSokosumiStatus,
  jobInclude,
} from "@sokosumi/database/types/job";
import type { MasumiPurchaseDiffEntry } from "@sokosumi/masumi/clients";

import { paymentClient } from "@/clients/masumi-payment.client";
import prisma from "@/lib/db/prisma";

/**
 * Cursor key for the purchase diff feed. Versioned like the registry cursor
 * (see AGENTS_SYNC_METADATA_KEY): bump the suffix whenever already-applied
 * purchases must be replayed, so an old binary cannot advance the new cursor
 * during a rolling deployment.
 */
export const PURCHASE_DIFF_SYNC_METADATA_KEY = "purchase-diff-sync:v1";

/** Rows per diff request. The run deadline, not this number, bounds a run. */
export const PURCHASE_DIFF_PAGE_SIZE = 50;

const PURCHASE_DIFF_REQUEST_TIMEOUT_MS = 10_000;

export interface PurchaseDiffSyncOptions {
  abortSignal: AbortSignal;
  /**
   * Applies one changed purchase to its job. Returns true when the job was
   * updated. A throw parks the cursor on the previous row, so the failing
   * purchase is retried on the next run.
   */
  applyPurchase: (
    job: JobWithSokosumiStatus,
    purchase: MasumiPurchaseDiffEntry,
  ) => Promise<boolean>;
  deadlineMs: number;
  /** Replays the whole feed from the beginning. */
  resetCursor?: boolean;
  shouldContinue: () => boolean;
}

export interface PurchaseDiffSyncResult {
  /** Diff rows read from the node, including rows that are not ours. */
  found: number;
  /** Rows that updated one of our jobs. */
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
 * Jobs owning the given payment-node purchase ids, keyed by purchase id.
 * `JobPurchase.externalId` is unique and holds exactly the node's purchase id,
 * so this is an id join — the same join the per-job poll gave up when it
 * switched to resolving by blockchain identifier.
 */
async function getJobsByPurchaseExternalId(
  externalIds: string[],
): Promise<Map<string, JobWithSokosumiStatus>> {
  const rows = await prisma.jobPurchase.findMany({
    where: { externalId: { in: externalIds } },
    include: { job: { include: jobInclude } },
  });
  return new Map(
    rows.map((row) => [row.externalId, mapJobWithStatus(row.job)]),
  );
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
  // The externalId join already established that this row is this job's
  // purchase, so refusing here would strand the job instead of protecting it.
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
  return {
    changedAt: metadata?.lastSyncedAt ?? new Date(0),
    cursorId: metadata?.cursorId ?? null,
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

/**
 * Pulls the purchases that changed since the stored cursor and applies each to
 * its job. One request per page replaces one request per unfinished job, so a
 * run costs what actually changed on the node rather than what is open here.
 *
 * The cursor only ever advances over a contiguous prefix of handled rows: a
 * row that fails to apply stops the run with the cursor parked in front of it,
 * exactly like the registry sync (agent-sync.service.ts).
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
      {
        signal: AbortSignal.any([
          options.abortSignal,
          AbortSignal.timeout(PURCHASE_DIFF_REQUEST_TIMEOUT_MS),
        ]),
      },
    );
    if (purchasesResult.isErr()) {
      console.error(
        "[sync/jobs/purchase-diff] Diff request failed; cursor not advanced:",
        purchasesResult.error,
      );
      break;
    }

    const purchases = purchasesResult.value;
    if (purchases.length === 0) {
      break;
    }
    found += purchases.length;

    const jobsByPurchaseId = await getJobsByPurchaseExternalId(
      purchases.map((purchase) => purchase.id),
    );

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
        if (await options.applyPurchase(job, purchase)) {
          processed++;
        }
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
