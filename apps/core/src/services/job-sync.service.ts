import * as Sentry from "@sentry/node";
import {
  AgentJobStatus,
  JobType,
  NotificationKind,
  Prisma,
} from "@sokosumi/database";
import {
  buildJobsNeedingAgentStatusSyncWhere,
  buildJobsNeedingPurchaseSyncWhere,
  buildJobsPendingLocalRefundWhere,
  mapJobWithStatus,
} from "@sokosumi/database/helpers";
import {
  jobEventRepository,
  jobPurchaseRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import {
  type JobWithSokosumiStatus,
  jobInclude,
} from "@sokosumi/database/types/job";
import {
  type JobFailureNotificationEmailProps,
  renderJobFailureNotificationEmail,
  renderJobFinalStatusEmail,
  renderJobInputRequiredEmail,
} from "@sokosumi/email";
import {
  createAgentClient,
  doesResolvedPurchaseSellerMatch,
  doMasumiPaymentAmountsMatch,
  normalizeV2RegistryIdentifier,
} from "@sokosumi/masumi";
import {
  buildWebhookFailureContext,
  postWebhook,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import pLimit from "p-limit";
import { sendEmail } from "@/clients/email.client";
import { paymentClient } from "@/clients/masumi-payment.client";
import { WEBHOOK_TIMEOUT_MS, WEBHOOK_USER_AGENT } from "@/config/constants";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import { getAgentName, toMasumiAgentForJob } from "@/helpers/agent";
import { createNotification } from "@/helpers/notifications";
import { transformPurchaseToJobUpdate } from "@/helpers/purchase";
import { publishJobStatusData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { refundJob } from "@/services/job-refund";
import { sourceImportService } from "@/services/source-import.service";

const JOB_SYNC_CONCURRENCY = 5;
const JOB_SYNC_REMOTE_TIMEOUT_BUFFER_MS = 250;
const JOB_SYNC_REMOTE_TIMEOUT_MS = 10_000;
const JOB_SYNC_TRANSACTION_OPTIONS = {
  maxWait: 5000,
  timeout: 20_000,
} as const;

type JobStatusValue =
  | "awaiting_payment"
  | "awaiting_input"
  | "running"
  | "completed"
  | "failed";
type JobSyncKind = "purchase" | "agent" | "refund";

interface JobSyncPhaseResult {
  found: number;
  processed: number;
}

interface JobSyncTransactionResult {
  extractionContext?: { eventId: string; result: string; userId: string };
  job: JobWithSokosumiStatus;
  jobStatus: SokosumiJobStatus;
}

export interface JobSyncExecutionOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

export interface JobSyncResult {
  durationMs: number;
  processed: number;
  unfinishedFound: number;
}

function hasTimeRemaining(deadlineMs: number): boolean {
  return Date.now() < deadlineMs;
}

function getJobSyncLogPrefix(kind: JobSyncKind): string {
  switch (kind) {
    case "purchase":
      return "[sync/jobs/purchase]";
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
      case "purchase":
        return `Failed to sync purchase state for job ${jobId}`;
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

function jobStatusToAgentJobStatus(jobStatus: JobStatusValue): AgentJobStatus {
  switch (jobStatus) {
    case "awaiting_payment":
      return AgentJobStatus.AWAITING_PAYMENT;
    case "awaiting_input":
      return AgentJobStatus.AWAITING_INPUT;
    case "running":
      return AgentJobStatus.RUNNING;
    case "completed":
      return AgentJobStatus.COMPLETED;
    case "failed":
      return AgentJobStatus.FAILED;
    default: {
      const exhaustiveJobStatus: never = jobStatus;
      throw new Error(`Unknown job status: ${exhaustiveJobStatus}`);
    }
  }
}

function buildJobLink(job: JobWithSokosumiStatus): string {
  return `${getWebAppBaseUrl()}/agents/${job.agentId}/jobs/${job.id}`;
}

function buildFailureNotificationData(
  job: JobWithSokosumiStatus,
): JobFailureNotificationEmailProps {
  const latestEvent = job.events.at(0);

  return {
    network: getEnv().NETWORK,
    agentId: job.agentId,
    agentBlockchainIdentifier:
      job.agentBlockchainIdentifier ?? job.agent.blockchainIdentifier,
    agentName: getAgentName(job.agent),
    jobId: job.id,
    jobBlockchainIdentifier: job.blockchainIdentifier,
    onChainStatus: job.purchase?.onChainStatus ?? "N/A",
    agentStatus: job.status,
    result: latestEvent?.result ?? "N/A",
    resultHash: job.purchase?.resultHash ?? "N/A",
  };
}

function dispatchJobInAppNotification(
  job: JobWithSokosumiStatus,
  jobStatus: SokosumiJobStatus,
): void {
  const eventId = job.events.at(0)?.id;
  if (!eventId) {
    return;
  }

  void dispatchJobNotification(job, jobStatus, eventId);
}

async function dispatchFinalStatusNotification(
  job: JobWithSokosumiStatus,
  jobStatus: SokosumiJobStatus,
): Promise<void> {
  if (!job.owner.notificationsOptIn) {
    return;
  }

  dispatchJobInAppNotification(job, jobStatus);

  try {
    const agentName = getAgentName(job.agent);
    const email = await renderJobFinalStatusEmail({
      recipientName: job.owner.name,
      agentName,
      jobName: job.name ?? undefined,
      jobStatus,
      jobLink: buildJobLink(job),
      locale: "en",
    });

    await sendEmail({
      to: job.owner.email,
      tag: "job-final-status",
      subject: email.subject,
      html: email.html,
    }).catch((error) => {
      captureExternalServiceError(error, {
        label: "job-final-status",
        extra: {
          jobId: job.id,
          userId: job.ownerId,
          notificationType: "job-final-status",
        },
      });
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.ownerId,
        notificationType: "job-final-status",
      },
    });
  }
}

async function dispatchInputRequiredNotification(
  job: JobWithSokosumiStatus,
): Promise<void> {
  if (!job.owner.notificationsOptIn) {
    return;
  }

  dispatchJobInAppNotification(job, SokosumiJobStatus.INPUT_REQUIRED);

  try {
    const agentName = getAgentName(job.agent);
    const email = await renderJobInputRequiredEmail({
      recipientName: job.owner.name,
      agentName,
      jobName: job.name ?? undefined,
      jobLink: buildJobLink(job),
      locale: "en",
    });

    await sendEmail({
      to: job.owner.email,
      tag: "job-input-required",
      subject: email.subject,
      html: email.html,
    }).catch((error) => {
      captureExternalServiceError(error, {
        label: "job-input-required",
        extra: {
          jobId: job.id,
          userId: job.ownerId,
          notificationType: "job-input-required",
        },
      });
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.ownerId,
        notificationType: "job-input-required",
      },
    });
  }
}

async function dispatchJobFailureNotification(
  job: JobWithSokosumiStatus,
): Promise<void> {
  dispatchJobInAppNotification(job, job.status);

  try {
    const notificationData = buildFailureNotificationData(job);
    const webhookUrl = getEnv().JOB_FAILURE_WEBHOOK_URL;

    if (webhookUrl) {
      // Fire-and-forget: dispatch the webhook without blocking the email path.
      void postWebhook(webhookUrl, notificationData, {
        userAgent: WEBHOOK_USER_AGENT,
        timeoutMs: WEBHOOK_TIMEOUT_MS,
      })
        .then((result) => {
          if (result.status === "failed") {
            Sentry.captureMessage("Failed to call job-failure webhook", {
              level: "warning",
              extra: buildWebhookFailureContext(result, {
                jobId: job.id,
                userId: job.ownerId,
                notificationType: "job-failure-webhook",
                webhookUrl,
              }),
            });
          }
        })
        .catch(() => {
          // postWebhook never rejects; guard only against the reporter throwing.
        });
    }

    const stakeholderEmails = getEnv().JOB_FAILURE_NOTIFICATION_EMAILS.filter(
      (email) => email.trim() !== "",
    );
    const authorContactEmail = job.agent.authorContactEmail?.trim();

    let toRecipients: string[];
    let bccRecipients: string[] | undefined;

    if (authorContactEmail) {
      toRecipients = [authorContactEmail];
      bccRecipients =
        stakeholderEmails.length > 0 ? stakeholderEmails : undefined;
    } else {
      toRecipients = stakeholderEmails;
      bccRecipients = undefined;
    }

    if (toRecipients.length === 0) {
      return;
    }

    const email = await renderJobFailureNotificationEmail({
      ...notificationData,
      locale: "en",
    });

    await sendEmail({
      to: toRecipients,
      ...(bccRecipients && bccRecipients.length > 0
        ? { bcc: bccRecipients }
        : {}),
      tag: "job-failure-notification",
      subject: email.subject,
      html: email.html,
    }).catch((error) => {
      captureExternalServiceError(error, {
        label: "job-failure-email",
        extra: {
          jobId: job.id,
          userId: job.ownerId,
          notificationType: "job-failure-email",
        },
      });
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.ownerId,
        notificationType: "job-failure",
      },
    });
  }
}

async function dispatchJobNotification(
  job: JobWithSokosumiStatus,
  jobStatus: SokosumiJobStatus,
  eventId: string,
): Promise<void> {
  if (!job.owner.notificationsOptIn) {
    return;
  }

  try {
    const agentName = getAgentName(job.agent);
    const jobName = job.name ?? "Untitled job";

    let messageKey: string;
    switch (jobStatus) {
      case SokosumiJobStatus.COMPLETED:
        messageKey = "Notifications.Job.completed";
        break;
      case SokosumiJobStatus.REFUND_RESOLVED:
        messageKey = "Notifications.Job.refundResolved";
        break;
      case SokosumiJobStatus.DISPUTE_RESOLVED:
        messageKey = "Notifications.Job.disputeResolved";
        break;
      case SokosumiJobStatus.FAILED:
        messageKey = "Notifications.Job.failed";
        break;
      case SokosumiJobStatus.PAYMENT_FAILED:
        messageKey = "Notifications.Job.paymentFailed";
        break;
      case SokosumiJobStatus.INPUT_REQUIRED:
        messageKey = "Notifications.Job.inputRequired";
        break;
      default:
        return;
    }

    await createNotification({
      userId: job.ownerId,
      kind: NotificationKind.JOB,
      referenceId: job.id,
      eventId,
      messageKey,
      messageParams: {
        agentName,
        jobName,
      },
      metadata: {
        agentId: job.agentId,
        workspaceId: job.workspaceId,
      },
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.ownerId,
        notificationType: "job-notification",
      },
    });
  }
}

async function finalizeJobSyncResult(
  oldJobStatus: SokosumiJobStatus,
  transactionResult: JobSyncTransactionResult,
): Promise<void> {
  const updatedJob = transactionResult.job;

  if (transactionResult.extractionContext) {
    const { eventId, result, userId } = transactionResult.extractionContext;
    sourceImportService.enqueueFromMarkdown(eventId, result).catch((error) => {
      console.error("Failed to enqueue source import:", error);
      Sentry.captureException(error, {
        extra: {
          eventId,
          userId,
        },
      });
    });
  }

  const newJobStatus = transactionResult.jobStatus;
  if (newJobStatus === oldJobStatus) {
    return;
  }

  switch (newJobStatus) {
    case SokosumiJobStatus.COMPLETED:
    case SokosumiJobStatus.REFUND_RESOLVED:
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      void dispatchFinalStatusNotification(updatedJob, newJobStatus);
      break;
    case SokosumiJobStatus.INPUT_REQUIRED:
      void dispatchInputRequiredNotification(updatedJob);
      break;
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
      void dispatchJobFailureNotification(updatedJob);
      break;
    default:
      break;
  }

  try {
    await publishJobStatusData({
      agentId: updatedJob.agentId,
      userId: updatedJob.ownerId,
      jobId: updatedJob.id,
      jobStatus: updatedJob.status,
      jobStatusSettled: updatedJob.jobStatusSettled,
    });
  } catch (error) {
    console.error("Error publishing job status data", error);
  }
}

/**
 * Compares a purchase deadline (epoch-millisecond string) with the job's own.
 * A null/absent deadline on either side is NOT a match: the backfill can only
 * adopt a purchase whose terms it can actually verify.
 */
function matchesDeadline(
  purchaseValue: string | null | undefined,
  jobValue: Date | null | undefined,
): boolean {
  if (!purchaseValue || !jobValue) {
    return false;
  }
  return purchaseValue === String(jobValue.getTime());
}

/** Recreates the exact metadata sent by createPurchase for a stored job. */
function getExpectedPurchaseMetadata(job: {
  agentJobId: string;
  input: string | null;
}): string | null {
  if (typeof job.input !== "string") {
    return null;
  }
  try {
    return JSON.stringify({
      inputData: JSON.parse(job.input),
      jobId: job.agentJobId,
    });
  } catch {
    return null;
  }
}

async function syncPurchaseState(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncExecutionOptions,
): Promise<boolean> {
  const oldJobStatus = initialJob.status;
  let job = initialJob;

  if (job.jobType === JobType.PAID && job.purchase === null) {
    const backfillSignal = createPollingSignal(
      options,
      `Stopping before backfilling purchase for job ${job.id}`,
      "purchase",
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
        "purchase",
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
      // The agent identity is the strongest discriminator: two purchases can
      // share deadlines by coincidence, but not the agent they were signed
      // for. A missing input hash is treated as NON-matching (never a
      // wildcard) so an unidentifiable purchase is refused rather than
      // adopted.
      const expectedAgentIdentifier =
        job.agentBlockchainIdentifier ??
        job.agent?.blockchainIdentifier ??
        null;
      // The job snapshots the rail it was created on, so a purchase settling
      // through the other contract can never belong to it.
      const purchasePaymentSourceType =
        purchase.PaymentSource?.paymentSourceType ?? null;
      const doesPaymentSourceTypeMatch =
        job.paymentSourceType === null ||
        purchasePaymentSourceType === job.paymentSourceType;
      // New jobs snapshot their price, but jobs created before the snapshot
      // migration must retain their legacy reconciliation behavior. The
      // explicit marker distinguishes those rows from malformed new jobs.
      const doPaidFundsMatch =
        !job.purchaseAmountMatchRequired ||
        doMasumiPaymentAmountsMatch(job.purchaseAmounts, purchase.PaidFunds);
      const expectedPurchaseMetadata = getExpectedPurchaseMetadata(job);
      const doesPurchaseMatchJob =
        typeof job.inputHash === "string" &&
        job.inputHash.length > 0 &&
        purchase.inputHash === job.inputHash &&
        typeof job.sellerVkey === "string" &&
        job.sellerVkey.length > 0 &&
        doesResolvedPurchaseSellerMatch(purchase, job.sellerVkey) &&
        expectedPurchaseMetadata !== null &&
        purchase.metadata === expectedPurchaseMetadata &&
        expectedAgentIdentifier !== null &&
        normalizeV2RegistryIdentifier(purchase.agentIdentifier ?? "") ===
          normalizeV2RegistryIdentifier(expectedAgentIdentifier) &&
        doesPaymentSourceTypeMatch &&
        doPaidFundsMatch &&
        // Deadlines are typed non-null for paid jobs but the column is
        // nullable and the purchase selector deliberately admits legacy rows
        // with a null payByTime. A missing deadline means the terms cannot be
        // verified, so refuse the attach rather than throw on .getTime().
        matchesDeadline(purchase.payByTime, job.payByTime) &&
        matchesDeadline(purchase.submitResultTime, job.submitResultTime) &&
        matchesDeadline(purchase.unlockTime, job.unlockTime) &&
        matchesDeadline(
          purchase.externalDisputeUnlockTime,
          job.externalDisputeUnlockTime,
        );
      if (!doesPurchaseMatchJob) {
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
            "purchase",
            `Skipping purchase backfill for job ${job.id}: ${code}`,
          );
        } else if (code === "P2014" || code === "P2025") {
          // Job was deleted or the relation can't be satisfied; nothing to
          // sync. Skip the refresh below, which would otherwise throw
          // "Job not found" for the now-missing job.
          logJobSyncInfo(
            "purchase",
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

  const purchaseExternalIdToSync = job.purchase?.externalId ?? null;
  const jobBlockchainIdentifier = job.blockchainIdentifier;
  if (!purchaseExternalIdToSync || !jobBlockchainIdentifier) {
    await finalizeJobSyncResult(oldJobStatus, {
      job,
      jobStatus: job.status,
    });
    return true;
  }

  const pollingSignal = createPollingSignal(
    options,
    `Stopping before polling purchase status for job ${job.id}`,
    "purchase",
  );
  if (!pollingSignal) {
    return false;
  }

  // Poll by blockchain identifier: GET /purchase defaults to a V1-only
  // payment-source filter, so a purchase id cursor lookup can miss (or worse,
  // return a neighboring row for) V2 purchases.
  const onChainPurchaseResult =
    await paymentClient().getPurchaseByBlockchainIdentifier(
      jobBlockchainIdentifier,
      {
        signal: pollingSignal,
      },
    );
  if (
    pollingSignal.aborted ||
    shouldStopSync(
      options,
      `Stopping after polling purchase status for job ${job.id}`,
      "purchase",
    )
  ) {
    return false;
  }

  let transactionResult: JobSyncTransactionResult = {
    job,
    jobStatus: job.status,
  };

  if (onChainPurchaseResult.isOk()) {
    transactionResult = await prisma.$transaction(
      async (tx): Promise<JobSyncTransactionResult> => {
        const purchaseData = transformPurchaseToJobUpdate(
          onChainPurchaseResult.value,
        );
        await jobPurchaseRepository.updateJobPurchaseByJobId(
          job.id,
          purchaseData,
          tx,
        );

        const refreshedJob = await jobRepository.getJobById(job.id, tx);
        if (!refreshedJob) {
          throw new Error("Job not found");
        }

        return {
          job: refreshedJob,
          jobStatus: refreshedJob.status,
        };
      },
      JOB_SYNC_TRANSACTION_OPTIONS,
    );
  }

  await finalizeJobSyncResult(oldJobStatus, transactionResult);
  return true;
}

async function syncAgentStatus(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncExecutionOptions,
): Promise<boolean> {
  const oldJobStatus = initialJob.status;
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

  const transactionResult = await prisma.$transaction(
    async (tx): Promise<JobSyncTransactionResult> => {
      let extractionContext:
        | { eventId: string; result: string; userId: string }
        | undefined;

      let currentJob = initialJob;
      const latestJobEvent = await jobEventRepository.getLatestJobEventByJobId(
        initialJob.id,
        tx,
      );

      const hasUnchangedStatusHash =
        latestJobEvent?.statusHash &&
        latestJobEvent.statusHash === agentJobStatusResult.value.statusHash;

      if (!hasUnchangedStatusHash) {
        const inputSchemaData = agentJobStatusResult.value.input_schema;
        const inputSchemaValue = inputSchemaData
          ? JSON.stringify(inputSchemaData)
          : undefined;

        const newJobEvent = await jobEventRepository.createJobEventForJobId(
          initialJob.id,
          {
            status: jobStatusToAgentJobStatus(
              agentJobStatusResult.value.status as JobStatusValue,
            ),
            inputSchema: inputSchemaValue,
            result: agentJobStatusResult.value.result,
            statusHash: agentJobStatusResult.value.statusHash,
          },
          tx,
        );

        const refreshedJob = await jobRepository.getJobById(initialJob.id, tx);
        if (!refreshedJob) {
          throw new Error("Job not found");
        }
        currentJob = refreshedJob;

        const outputResult = agentJobStatusResult.value.result;
        if (typeof outputResult === "string") {
          extractionContext = {
            eventId: newJobEvent.id,
            result: outputResult,
            userId: currentJob.ownerId,
          };
        }
      }

      return {
        extractionContext,
        job: currentJob,
        jobStatus: currentJob.status,
      };
    },
    JOB_SYNC_TRANSACTION_OPTIONS,
  );

  await finalizeJobSyncResult(oldJobStatus, transactionResult);
  return true;
}

async function syncRefundReconciliationJob(
  job: JobWithSokosumiStatus,
  options: JobSyncExecutionOptions,
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
  options: JobSyncExecutionOptions,
  seenJobIds: Set<string>,
  processor: (
    job: JobWithSokosumiStatus,
    options: JobSyncExecutionOptions,
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

  const foundMessage =
    kind === "refund"
      ? `Found ${jobs.length} jobs pending local refund`
      : `Found ${jobs.length} jobs for ${kind} sync`;
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
    const purchasePhase = await runSyncPhase(
      "purchase",
      buildJobsNeedingPurchaseSyncWhere(),
      options,
      seenJobIds,
      syncPurchaseState,
    );
    const agentPhase = await runSyncPhase(
      "agent",
      buildJobsNeedingAgentStatusSyncWhere(),
      options,
      seenJobIds,
      syncAgentStatus,
    );
    const refundPhase = await runSyncPhase(
      "refund",
      buildJobsPendingLocalRefundWhere(),
      options,
      seenJobIds,
      syncRefundReconciliationJob,
    );

    return {
      durationMs: Date.now() - startedAt,
      processed:
        purchasePhase.processed + agentPhase.processed + refundPhase.processed,
      unfinishedFound: seenJobIds.size,
    };
  },
};
