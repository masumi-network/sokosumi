import * as Sentry from "@sentry/node";
import { JobType, Prisma } from "@sokosumi/database";
import {
  buildJobsNeedingAgentStatusSyncWhere,
  buildJobsNeedingPurchaseBackfillWhere,
  buildJobsNeedingPurchaseTransactionSyncWhere,
  buildJobsPendingLocalRefundWhere,
  mapJobWithStatus,
} from "@sokosumi/database/helpers";
import {
  jobPurchaseRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import {
  type JobWithSokosumiStatus,
  jobInclude,
} from "@sokosumi/database/types/job";
import { createAgentClient } from "@sokosumi/masumi";
import pLimit from "p-limit";
import { type SendEmailInput, sendEmails } from "@/clients/email.client";
import { paymentClient } from "@/clients/masumi-payment.client";
import { toMasumiAgentForJob } from "@/helpers/agent";
import {
  doesPurchaseMatchJobTerms,
  transformPurchaseToJobUpdate,
} from "@/helpers/purchase";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { syncPurchasesFromDiff } from "@/services/job-purchase-diff.service";
import { refundJob } from "@/services/job-refund";
import {
  applyAgentState,
  applyPurchaseState,
  finalizeJobSyncResult,
  JOB_SYNC_TRANSACTION_OPTIONS,
} from "@/services/job-sync-state.service";

const JOB_SYNC_CONCURRENCY = 5;
const JOB_SYNC_REMOTE_TIMEOUT_BUFFER_MS = 250;
const JOB_SYNC_REMOTE_TIMEOUT_MS = 10_000;

type JobSyncKind =
  | "purchase-backfill"
  | "purchase-transaction"
  | "agent"
  | "refund";

interface JobSyncPhaseResult {
  found: number;
  processed: number;
}

export interface JobSyncExecutionOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  /** Replays the whole purchase diff feed instead of resuming at the cursor. */
  resetPurchaseCursor?: boolean;
  shouldContinue: () => boolean;
}

interface JobSyncRunOptions extends JobSyncExecutionOptions {
  enqueueEmail: (input: SendEmailInput) => void;
}

export interface JobSyncResult {
  durationMs: number;
  processed: number;
  unfinishedFound: number;
}

/**
 * Budget held back from the network-bound phases so the refund phase always
 * runs. One run deadline covers, in order: purchase backfill, the purchase
 * diff, the purchase-transaction poll, agent, then refund.
 *
 * Backfill polls the payment node once per purchase-less job (10s timeout, 5
 * concurrent), the diff reads one page of changed purchases per request, and
 * agent polls sellers — and since this release keeps polling snapshot-backed
 * jobs whose agent has gone offline (see `buildInFlightAgentSnapshotWhere`),
 * free jobs for 30 days. Any of them can consume the whole run on its own: a
 * slow payment node exhausts the budget before the agent phase starts. Refund
 * is database-only, cheap, and returns money to users, so it must not be the
 * thing that starves — and a slow node is exactly when refunds are most likely
 * to be needed.
 *
 * Reserving budget rather than reordering the phases: refund MUST run after
 * the backfill phase. It triggers on `purchase: null`, and backfill is what
 * attaches a JobPurchase row for a purchase that landed on chain since the
 * last run. Refunding first would return credits for a job whose escrow is
 * funded — paying the seller and the buyer both. Backfill also runs before the
 * diff, for the same reason: the diff's cost follows the node's change feed,
 * so it must not be able to starve the phase refund depends on.
 *
 * (`seenJobIds` is NOT what enforces this. It is only a deduplicated counter
 * for `unfinishedFound` across the four job-selector phases; the diff is
 * keyed on purchases rather than jobs and adds nothing to it. No query filters
 * on `seenJobIds`, and none needs to. Backfill and refund cannot collide:
 * backfill requires `purchase: null` inside the payment grace window, and the
 * only refund branch that reads a purchase-less job requires it past that
 * window. The agent and refund selectors do overlap backfill's siblings,
 * because they ask about the seller and about a withdrawn refund rather than
 * about a missing purchase row. That overlap is why the counter is a Set: two
 * phases can do different work on the same job in one run.)
 */
const REFUND_PHASE_RESERVED_MS = 20_000;

function hasTimeRemaining(deadlineMs: number): boolean {
  return Date.now() < deadlineMs;
}

function getJobSyncLogPrefix(kind: JobSyncKind): string {
  switch (kind) {
    case "purchase-backfill":
      return "[sync/jobs/purchase-backfill]";
    case "purchase-transaction":
      return "[sync/jobs/purchase-transaction]";
    case "agent":
      return "[sync/jobs/agent]";
    case "refund":
      return "[sync/jobs/refund]";
  }
}

function logJobSyncInfo(kind: JobSyncKind, message: string): void {
  console.info(`${getJobSyncLogPrefix(kind)} ${message}`);
}

function logJobSyncError(
  kind: JobSyncKind,
  jobId: string,
  error: unknown,
): void {
  const message = (() => {
    switch (kind) {
      case "purchase-backfill":
        return `Failed to backfill the purchase for job ${jobId}`;
      case "purchase-transaction":
        return `Failed to sync the purchase transaction for job ${jobId}`;
      case "agent":
        return `Failed to sync agent status for job ${jobId}`;
      case "refund":
        return `Failed to reconcile refund for job ${jobId}`;
    }
  })();
  console.error(`${getJobSyncLogPrefix(kind)} ${message}`, error);
}

function shouldStopSync(
  options: JobSyncExecutionOptions,
  reason: string,
  kind: JobSyncKind,
): boolean {
  if (!options.shouldContinue()) {
    logJobSyncInfo(kind, reason);
    return true;
  }

  if (options.abortSignal.aborted) {
    logJobSyncInfo(kind, reason);
    return true;
  }

  if (!hasTimeRemaining(options.deadlineMs)) {
    logJobSyncInfo(kind, reason);
    return true;
  }

  return false;
}

function createPollingSignal(
  options: JobSyncExecutionOptions,
  reason: string,
  kind: JobSyncKind,
): AbortSignal | null {
  if (shouldStopSync(options, reason, kind)) {
    return null;
  }

  const remainingBudgetMs =
    options.deadlineMs - Date.now() - JOB_SYNC_REMOTE_TIMEOUT_BUFFER_MS;
  if (remainingBudgetMs <= 0) {
    logJobSyncInfo(kind, reason);
    return null;
  }

  return AbortSignal.any([
    options.abortSignal,
    AbortSignal.timeout(
      Math.min(remainingBudgetMs, JOB_SYNC_REMOTE_TIMEOUT_MS),
    ),
  ]);
}

async function backfillJobPurchase(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncRunOptions,
): Promise<boolean> {
  const oldJobStatus = initialJob.status;
  let job = initialJob;

  if (job.jobType === JobType.PAID && job.purchase === null) {
    const backfillSignal = createPollingSignal(
      options,
      `Stopping before backfilling purchase for job ${job.id}`,
      "purchase-backfill",
    );
    if (!backfillSignal) {
      return false;
    }

    const purchaseResult =
      await paymentClient().getPurchaseByBlockchainIdentifier(
        job.blockchainIdentifier,
        {
          signal: backfillSignal,
        },
      );
    if (
      backfillSignal.aborted ||
      shouldStopSync(
        options,
        `Stopping after backfilling purchase for job ${job.id}`,
        "purchase-backfill",
      )
    ) {
      return false;
    }

    if (purchaseResult.isOk()) {
      const purchase = purchaseResult.value;
      // Attach ONLY a purchase matching the job's own seller-signed terms.
      // Without this, a foreign purchase sharing the blockchainIdentifier —
      // the exact case the 409 duplicate guard refuses at creation — would be
      // silently adopted here one cron cycle later.
      if (!doesPurchaseMatchJobTerms(purchase, job)) {
        const mismatchError = new Error(
          `Resolved purchase does not match job terms; refusing purchase backfill for job ${job.id}`,
        );
        console.error(mismatchError.message, {
          jobId: job.id,
          blockchainIdentifier: job.blockchainIdentifier,
          purchaseId: purchase.id,
        });
        Sentry.captureException(mismatchError);
        return false;
      }
      const purchaseData = transformPurchaseToJobUpdate(purchase);
      try {
        await jobPurchaseRepository.createJobPurchase(
          {
            jobId: job.id,
            ...purchaseData,
          },
          prisma,
        );
      } catch (error) {
        const code =
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code: unknown }).code === "string"
            ? (error as { code: string }).code
            : null;
        if (code === "P2002") {
          // Unique constraint: purchase already created by a concurrent
          // request. The row exists, so fall through to refresh and finalize.
          logJobSyncInfo(
            "purchase-backfill",
            `Skipping purchase backfill for job ${job.id}: ${code}`,
          );
        } else if (code === "P2014" || code === "P2025") {
          // Job was deleted or the relation can't be satisfied; nothing to
          // sync. Skip the refresh below, which would otherwise throw
          // "Job not found" for the now-missing job.
          logJobSyncInfo(
            "purchase-backfill",
            `Skipping purchase backfill for job ${job.id}: ${code}`,
          );
          return false;
        } else {
          throw error;
        }
      }
    }

    const refreshedJob = await jobRepository.getJobById(job.id, prisma);
    if (!refreshedJob) {
      throw new Error("Job not found");
    }
    job = refreshedJob;
  }

  await finalizeJobSyncResult(
    oldJobStatus,
    {
      job,
      jobStatus: job.status,
    },
    options.enqueueEmail,
  );
  return true;
}

async function syncPurchaseTransaction(
  job: JobWithSokosumiStatus,
  options: JobSyncRunOptions,
): Promise<boolean> {
  if (!job.blockchainIdentifier) {
    return true;
  }

  const pollingSignal = createPollingSignal(
    options,
    `Stopping before polling the purchase transaction for job ${job.id}`,
    "purchase-transaction",
  );
  if (!pollingSignal) {
    return false;
  }

  const purchaseResult =
    await paymentClient().getPurchaseByBlockchainIdentifier(
      job.blockchainIdentifier,
      { signal: pollingSignal },
    );
  if (
    pollingSignal.aborted ||
    shouldStopSync(
      options,
      `Stopping after polling the purchase transaction for job ${job.id}`,
      "purchase-transaction",
    )
  ) {
    return false;
  }
  if (purchaseResult.isErr()) {
    return true;
  }
  const purchase = purchaseResult.value;
  const identifierMatches =
    typeof purchase.blockchainIdentifier !== "string" ||
    purchase.blockchainIdentifier.length === 0 ||
    typeof job.blockchainIdentifier !== "string" ||
    job.blockchainIdentifier.length === 0 ||
    purchase.blockchainIdentifier.toLowerCase() ===
      job.blockchainIdentifier.toLowerCase();
  const attachedPurchaseMatches =
    purchase.id === job.purchase?.externalId && identifierMatches;
  if (!attachedPurchaseMatches && !doesPurchaseMatchJobTerms(purchase, job)) {
    const mismatchError = new Error(
      `Resolved purchase does not match job terms; refusing purchase transaction update for job ${job.id}`,
    );
    console.error(mismatchError.message, {
      jobId: job.id,
      blockchainIdentifier: job.blockchainIdentifier,
      purchaseId: purchaseResult.value.id,
    });
    Sentry.captureException(mismatchError);
    return false;
  }

  await applyPurchaseState(job, purchase, options.enqueueEmail);
  return true;
}

async function syncAgentStatus(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncRunOptions,
): Promise<boolean> {
  const agentJobIdToSync = initialJob.agentJobId;
  if (!agentJobIdToSync) {
    return true;
  }

  // Agents without a MIP-003 endpoint (pointer entries) have no status
  // endpoint to poll; such agents cannot be hired, so this only guards
  // legacy/corner rows.
  if (
    !initialJob.agentApiBaseUrl &&
    !initialJob.agent.apiBaseUrl &&
    !initialJob.agent.metadataOverride?.apiBaseUrl
  ) {
    return true;
  }

  const pollingSignal = createPollingSignal(
    options,
    `Stopping before polling agent status for job ${initialJob.id}`,
    "agent",
  );
  if (!pollingSignal) {
    return false;
  }

  const agentJobStatusResult = await createAgentClient().fetchAgentJobStatus(
    toMasumiAgentForJob(initialJob),
    agentJobIdToSync,
    {
      signal: pollingSignal,
    },
  );
  if (
    pollingSignal.aborted ||
    shouldStopSync(
      options,
      `Stopping after polling agent status for job ${initialJob.id}`,
      "agent",
    )
  ) {
    return false;
  }

  if (agentJobStatusResult.isErr()) {
    return true;
  }

  await applyAgentState(
    initialJob,
    agentJobStatusResult.value,
    options.enqueueEmail,
  );
  return true;
}

async function syncRefundReconciliationJob(
  job: JobWithSokosumiStatus,
  options: JobSyncRunOptions,
): Promise<boolean> {
  if (
    shouldStopSync(
      options,
      `Stopping before reconciling refund for job ${job.id}`,
      "refund",
    )
  ) {
    return false;
  }

  await prisma.$transaction(async (tx) => {
    await refundJob(job.id, tx);
  }, JOB_SYNC_TRANSACTION_OPTIONS);

  return true;
}

async function runSyncPhase(
  kind: JobSyncKind,
  where: Prisma.JobWhereInput,
  options: JobSyncRunOptions,
  seenJobIds: Set<string>,
  processor: (
    job: JobWithSokosumiStatus,
    options: JobSyncRunOptions,
  ) => Promise<boolean>,
): Promise<JobSyncPhaseResult> {
  // Deliberately unbounded and unordered. A cap combined with a stable order
  // is worse than no cap here: nothing evicts a job that never reaches a
  // terminal agent status (free jobs have no other exit at all), so a fixed
  // prefix of permanently stuck jobs would hide every newer job from the
  // phase forever. The selectors themselves keep this set small — the agent
  // phase is gated on ONLINE plus bounded snapshot-backed jobs — and the
  // per-run deadline bounds the work actually performed.
  const jobs = (
    await prisma.job.findMany({
      where,
      include: jobInclude,
    })
  ).map(mapJobWithStatus);

  for (const job of jobs) {
    seenJobIds.add(job.id);
  }

  const foundMessage = (() => {
    switch (kind) {
      case "refund":
        return `Found ${jobs.length} jobs pending local refund`;
      case "purchase-backfill":
        return `Found ${jobs.length} jobs needing a purchase backfill`;
      case "purchase-transaction":
        return `Found ${jobs.length} jobs needing purchase transaction sync`;
      case "agent":
        return `Found ${jobs.length} jobs for agent sync`;
    }
  })();
  logJobSyncInfo(kind, foundMessage);

  const limit = pLimit(JOB_SYNC_CONCURRENCY);
  const tasks = jobs.map((job) =>
    limit(async () => {
      if (
        shouldStopSync(
          options,
          `Stopping before processing job ${job.id}`,
          kind,
        )
      ) {
        return false;
      }

      try {
        return await processor(job, options);
      } catch (error) {
        logJobSyncError(kind, job.id, error);
        captureExternalServiceError(error, {
          label: `[sync/jobs/${kind}]`,
          extra: {
            jobId: job.id,
          },
        });
      }

      return false;
    }),
  );

  const results = await Promise.allSettled(tasks);
  const processed = results.filter(
    (result) => result.status === "fulfilled" && result.value,
  ).length;

  return {
    found: jobs.length,
    processed,
  };
}

export const jobSyncService = {
  async syncUnfinishedJobs(
    options: JobSyncExecutionOptions,
  ): Promise<JobSyncResult> {
    const startedAt = Date.now();
    const seenJobIds = new Set<string>();
    const pendingEmails: SendEmailInput[] = [];
    const runOptions: JobSyncRunOptions = {
      ...options,
      enqueueEmail: (input) => {
        pendingEmails.push(input);
      },
    };

    let diffProcessed = 0;
    let backfillPhase: JobSyncPhaseResult = { found: 0, processed: 0 };
    let purchaseTransactionPhase: JobSyncPhaseResult = {
      found: 0,
      processed: 0,
    };
    let agentPhase: JobSyncPhaseResult = { found: 0, processed: 0 };
    let refundPhase: JobSyncPhaseResult = { found: 0, processed: 0 };

    // All four network-bound phases share one reserved deadline, so whichever
    // of them is slow, the refund phase still gets its budget. Reserving only
    // against the agent phase left the phases that run before it able to
    // consume the whole run on their own, collapsing the agent budget to zero
    // and starving refunds anyway.
    const networkPhaseOptions = {
      ...runOptions,
      deadlineMs: Math.max(
        Date.now(),
        runOptions.deadlineMs - REFUND_PHASE_RESERVED_MS,
      ),
    };

    try {
      // Backfill BEFORE the diff. Its work is bounded by our own recent hires,
      // while the diff drains whatever the node changed — a backlog, or the
      // whole 30-day lookback on a first run. Letting the diff go first left a
      // job whose JobPurchase write was lost at hire time unattached past the
      // payment grace window, and the refund phase then returns credits for an
      // escrow that is funded on chain.
      backfillPhase = await runSyncPhase(
        "purchase-backfill",
        buildJobsNeedingPurchaseBackfillWhere(),
        networkPhaseOptions,
        seenJobIds,
        backfillJobPurchase,
      );

      // Changed purchases: one request per page of node-side changes, instead
      // of one request per unfinished job. Isolated in its own try/catch — an
      // unexpected throw here (a transient Prisma failure while reading the
      // cursor, say) must not skip the agent and refund phases below.
      try {
        const purchaseDiff = await syncPurchasesFromDiff({
          abortSignal: options.abortSignal,
          applyPurchase: (job, purchase) =>
            applyPurchaseState(job, purchase, runOptions.enqueueEmail),
          deadlineMs: networkPhaseOptions.deadlineMs,
          shouldContinue: options.shouldContinue,
          ...(options.resetPurchaseCursor ? { resetCursor: true } : {}),
        });
        diffProcessed = purchaseDiff.processed;
      } catch (error) {
        console.error("[sync/jobs/purchase-diff] Diff sync failed:", error);
        // Through the shared helper, not Sentry directly: the transient
        // Prisma failures this block exists for (P2028 pool timeouts, P2034,
        // a deploy-window schema drift) would otherwise page on every tick.
        captureExternalServiceError(error, {
          label: "sync/jobs/purchase-diff",
        });
      }

      purchaseTransactionPhase = await runSyncPhase(
        "purchase-transaction",
        buildJobsNeedingPurchaseTransactionSyncWhere(),
        networkPhaseOptions,
        seenJobIds,
        syncPurchaseTransaction,
      );

      agentPhase = await runSyncPhase(
        "agent",
        buildJobsNeedingAgentStatusSyncWhere(),
        networkPhaseOptions,
        seenJobIds,
        syncAgentStatus,
      );
      refundPhase = await runSyncPhase(
        "refund",
        buildJobsPendingLocalRefundWhere(),
        runOptions,
        seenJobIds,
        syncRefundReconciliationJob,
      );
    } finally {
      // Flush even if a later phase throws so already-queued emails are not dropped.
      if (pendingEmails.length > 0) {
        await sendEmails(pendingEmails).catch((error) => {
          captureExternalServiceError(error, {
            label: "job-sync-email-batch",
            extra: {
              emailCount: pendingEmails.length,
            },
          });
        });
      }
    }

    return {
      durationMs: Date.now() - startedAt,
      processed:
        diffProcessed +
        backfillPhase.processed +
        purchaseTransactionPhase.processed +
        agentPhase.processed +
        refundPhase.processed,
      unfinishedFound: seenJobIds.size,
    };
  },
};
