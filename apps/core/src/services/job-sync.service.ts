import * as Sentry from "@sentry/node";
import { JobType, Prisma } from "@sokosumi/database";
import {
  buildJobsNeedingAgentStatusSyncWhere,
  buildJobsNeedingPurchaseBackfillWhere,
  buildJobsNeedingPurchaseTransactionSyncWhere,
  buildJobsPendingLocalRefundWhere,
  mapJobWithStatus,
} from "@sokosumi/database/helpers";
import { jobPurchaseRepository } from "@sokosumi/database/repositories";
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
import { createCoreLogger, emitCoreError } from "@/lib/evlog";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
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

/** Names the jobs cron's events; job sync runs only there. */
const JOB_SYNC_OPERATION = "job_sync";

interface JobSyncPhaseResult {
  found: number;
  processed: number;
  /** Where the phase stopped early; null when it did not. */
  stopped: string | null;
  /** Backfills skipped because the database refused the write (Prisma code). */
  skipped: { jobId: string; code: string }[];
}

function emptyPhase(): JobSyncPhaseResult {
  return { found: 0, processed: 0, stopped: null, skipped: [] };
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

/** One phase's run options, carrying the result its summary reports. */
interface JobSyncPhaseOptions extends JobSyncRunOptions {
  phase: JobSyncPhaseResult;
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

/** A job a phase could not process: what failed, and why, as Core says it. */
function jobSyncFailure(kind: JobSyncKind): { message: string; why: string } {
  switch (kind) {
    case "purchase-backfill":
      return {
        message: "Could not backfill a job's purchase",
        why: "Reading or attaching the purchase from the payment node threw",
      };
    case "purchase-transaction":
      return {
        message: "Could not sync a job's purchase transaction",
        why: "Applying the payment node's purchase state threw",
      };
    case "agent":
      return {
        message: "Could not sync a job's agent status",
        why: "Applying the agent's job status threw",
      };
    case "refund":
      return {
        message: "Could not reconcile a job's refund",
        why: "The refund transaction threw",
      };
  }
}

/** Records the first reason a phase stopped early, for its summary. */
function shouldStopSync(options: JobSyncPhaseOptions, reason: string): boolean {
  if (
    !options.shouldContinue() ||
    options.abortSignal.aborted ||
    !hasTimeRemaining(options.deadlineMs)
  ) {
    options.phase.stopped ??= reason;
    return true;
  }

  return false;
}

function createPollingSignal(
  options: JobSyncPhaseOptions,
  reason: string,
): AbortSignal | null {
  if (shouldStopSync(options, reason)) {
    return null;
  }

  const remainingBudgetMs =
    options.deadlineMs - Date.now() - JOB_SYNC_REMOTE_TIMEOUT_BUFFER_MS;
  if (remainingBudgetMs <= 0) {
    options.phase.stopped ??= reason;
    return null;
  }

  return AbortSignal.any([
    options.abortSignal,
    AbortSignal.timeout(
      Math.min(remainingBudgetMs, JOB_SYNC_REMOTE_TIMEOUT_MS),
    ),
  ]);
}

/** A purchase the node resolved for a job but whose terms are not the job's. */
function emitPurchaseMismatch(
  job: JobWithSokosumiStatus,
  purchaseId: string,
  kind: "purchase-backfill" | "purchase-transaction",
): void {
  emitCoreError(
    {
      operation: JOB_SYNC_OPERATION,
      jobSyncPhase: kind,
      job: { id: job.id, blockchainIdentifier: job.blockchainIdentifier },
      purchase: { id: purchaseId },
    },
    {
      message:
        kind === "purchase-backfill"
          ? "Refused to attach a purchase to its job"
          : "Refused to update a job from its purchase transaction",
      why: "The purchase the payment node resolved for the job's blockchain identifier does not match the job's terms",
      fix: "Compare the purchase on the payment node with the job (Sentry has the same error). The job keeps its stored purchase state until they agree.",
    },
  );
}

async function backfillJobPurchase(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncPhaseOptions,
): Promise<boolean> {
  const oldJobStatus = initialJob.status;
  let job = initialJob;

  if (job.jobType === JobType.PAID && job.purchase === null) {
    const backfillSignal = createPollingSignal(
      options,
      `Stopping before backfilling purchase for job ${job.id}`,
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
        emitPurchaseMismatch(job, purchase.id, "purchase-backfill");
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
          options.phase.skipped.push({ jobId: job.id, code });
        } else if (code === "P2014" || code === "P2025") {
          // Job was deleted or the relation can't be satisfied; nothing to
          // sync. Skip the refresh below, which would otherwise throw
          // "Job not found" for the now-missing job.
          options.phase.skipped.push({ jobId: job.id, code });
          return false;
        } else {
          throw error;
        }
      }
    }

    const refreshedJobRow = await prisma.job.findUnique({
      where: { id: job.id },
      include: jobInclude,
    });
    if (!refreshedJobRow) {
      throw new Error("Job not found");
    }
    job = mapJobWithStatus(refreshedJobRow);
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
  options: JobSyncPhaseOptions,
): Promise<boolean> {
  if (!job.blockchainIdentifier) {
    return true;
  }

  const pollingSignal = createPollingSignal(
    options,
    `Stopping before polling the purchase transaction for job ${job.id}`,
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
    emitPurchaseMismatch(job, purchaseResult.value.id, "purchase-transaction");
    Sentry.captureException(mismatchError);
    return false;
  }

  await applyPurchaseState(job, purchase, options.enqueueEmail);
  return true;
}

async function syncAgentStatus(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncPhaseOptions,
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
  options: JobSyncPhaseOptions,
): Promise<boolean> {
  if (
    shouldStopSync(
      options,
      `Stopping before reconciling refund for job ${job.id}`,
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
  runOptions: JobSyncRunOptions,
  seenJobIds: Set<string>,
  processor: (
    job: JobWithSokosumiStatus,
    options: JobSyncPhaseOptions,
  ) => Promise<boolean>,
): Promise<JobSyncPhaseResult> {
  const phase = emptyPhase();
  const options: JobSyncPhaseOptions = { ...runOptions, phase };
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

  phase.found = jobs.length;

  const limit = pLimit(JOB_SYNC_CONCURRENCY);
  const tasks = jobs.map((job) =>
    limit(async () => {
      if (shouldStopSync(options, `Stopping before processing job ${job.id}`)) {
        return false;
      }

      try {
        return await processor(job, options);
      } catch (error) {
        emitCoreError(
          {
            operation: JOB_SYNC_OPERATION,
            jobSyncPhase: kind,
            job: { id: job.id },
          },
          {
            ...jobSyncFailure(kind),
            fix: "The next jobs sync retries the job. If it fails every run, Sentry has the error.",
          },
          // Only safe fields: a job's state carries what its agent returned,
          // and a write error can quote it. Sentry keeps the full error.
          { failure: messageSafeErrorFields(error) },
        );
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
  phase.processed = results.filter(
    (result) => result.status === "fulfilled" && result.value,
  ).length;

  return phase;
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
    let backfillPhase = emptyPhase();
    let purchaseTransactionPhase = emptyPhase();
    let agentPhase = emptyPhase();
    let refundPhase = emptyPhase();
    // Runs after the jobs cron response: the run is one standalone event with
    // each phase's counts. A job that fails is its own error event.
    const log = createCoreLogger({ operation: JOB_SYNC_OPERATION });

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
        emitCoreError(
          { operation: JOB_SYNC_OPERATION, jobSyncPhase: "purchase-diff" },
          {
            message: "Could not sync changed purchases from the payment node",
            why: "The purchase diff threw before it finished",
            fix: "The other phases still run, and the next jobs sync resumes the diff from its stored cursor. If it fails every run, Sentry has the error.",
          },
          // Only safe fields: the diff writes the provider's error notes and
          // relays proxy bodies, which an error can quote.
          { failure: messageSafeErrorFields(error) },
        );
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
      log.set({
        jobSync: {
          phases: {
            purchaseBackfill: backfillPhase,
            purchaseDiff: { processed: diffProcessed },
            purchaseTransaction: purchaseTransactionPhase,
            agent: agentPhase,
            refund: refundPhase,
          },
          unfinishedFound: seenJobIds.size,
        },
      });
      log.emit();
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
