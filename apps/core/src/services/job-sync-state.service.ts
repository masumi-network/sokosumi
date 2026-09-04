import * as Sentry from "@sentry/node";
import { AgentJobStatus, NotificationKind } from "@sokosumi/database";
import {
  jobEventRepository,
  jobPurchaseRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import type { JobWithSokosumiStatus } from "@sokosumi/database/types/job";
import {
  type JobFailureNotificationEmailProps,
  renderJobFailureNotificationEmail,
  renderJobFinalStatusEmail,
  renderJobInputRequiredEmail,
} from "@sokosumi/email";
import type { PostPurchaseResponses } from "@sokosumi/masumi/clients";
import type { JobStatusResponseSchemaType } from "@sokosumi/masumi/schemas";
import {
  buildWebhookFailureContext,
  postWebhook,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import type { SendEmailInput } from "@/clients/email.client";
import { WEBHOOK_TIMEOUT_MS, WEBHOOK_USER_AGENT } from "@/config/constants";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import { getAgentName } from "@/helpers/agent";
import { createNotification } from "@/helpers/notifications";
import { transformPurchaseToJobUpdate } from "@/helpers/purchase";
import { publishJobStatusData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { sourceImportService } from "@/services/source-import.service";

type JobStatusValue =
  | "awaiting_payment"
  | "awaiting_input"
  | "running"
  | "completed"
  | "failed";

type MasumiPurchase = PostPurchaseResponses["200"]["data"];
type MasumiAgentJobStatus = JobStatusResponseSchemaType & {
  statusHash: string;
};

interface JobSyncTransactionResult {
  extractionContext?: { eventId: string; result: string; userId: string };
  job: JobWithSokosumiStatus;
  jobStatus: SokosumiJobStatus;
}

export const JOB_SYNC_TRANSACTION_OPTIONS = {
  maxWait: 5000,
  timeout: 20_000,
} as const;

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
  enqueueEmail: (input: SendEmailInput) => void,
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

    enqueueEmail({
      to: job.owner.email,
      tag: "job-final-status",
      subject: email.subject,
      html: email.html,
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
  enqueueEmail: (input: SendEmailInput) => void,
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

    enqueueEmail({
      to: job.owner.email,
      tag: "job-input-required",
      subject: email.subject,
      html: email.html,
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
  enqueueEmail: (input: SendEmailInput) => void,
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

    enqueueEmail({
      to: toRecipients,
      ...(bccRecipients && bccRecipients.length > 0
        ? { bcc: bccRecipients }
        : {}),
      tag: "job-failure-notification",
      subject: email.subject,
      html: email.html,
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

export async function finalizeJobSyncResult(
  oldJobStatus: SokosumiJobStatus,
  transactionResult: JobSyncTransactionResult,
  enqueueEmail: (input: SendEmailInput) => void,
): Promise<void> {
  const updatedJob = transactionResult.job;

  if (transactionResult.extractionContext) {
    const { eventId, result, userId } = transactionResult.extractionContext;
    // waitUntil covers this path. Detaching it left nested link upserts
    // idle-in-transaction after the continuation deadline.
    await sourceImportService
      .enqueueFromMarkdown(eventId, result)
      .catch((error) => {
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

  // Await render+enqueue; Resend batch flush runs at end of syncUnfinishedJobs.
  switch (newJobStatus) {
    case SokosumiJobStatus.COMPLETED:
    case SokosumiJobStatus.REFUND_RESOLVED:
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      await dispatchFinalStatusNotification(
        updatedJob,
        newJobStatus,
        enqueueEmail,
      );
      break;
    case SokosumiJobStatus.INPUT_REQUIRED:
      await dispatchInputRequiredNotification(updatedJob, enqueueEmail);
      break;
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
      await dispatchJobFailureNotification(updatedJob, enqueueEmail);
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
 * Writes one changed purchase from the diff feed onto its job and finalizes it
 * exactly as the purchase phase did: emails, notifications, webhook, Ably
 * publish. The diff feed replaces the broad per-job poll. A narrow poll remains
 * for pending transaction fields that do not move the diff cursor. Everything
 * after the write is unchanged. No status event is written here, and none was
 * written by the poll either: only syncAgentStatus records one, because only
 * the agent reports a result to record.
 */
export async function applyPurchaseState(
  job: JobWithSokosumiStatus,
  purchase: MasumiPurchase,
  enqueueEmail: (input: SendEmailInput) => void,
): Promise<void> {
  const oldJobStatus = job.status;
  const transactionResult = await prisma.$transaction(
    async (tx): Promise<JobSyncTransactionResult> => {
      await jobPurchaseRepository.updateJobPurchaseByJobId(
        job.id,
        transformPurchaseToJobUpdate(purchase),
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

  await finalizeJobSyncResult(oldJobStatus, transactionResult, enqueueEmail);
}

export async function applyAgentState(
  initialJob: JobWithSokosumiStatus,
  agentJobStatus: MasumiAgentJobStatus,
  enqueueEmail: (input: SendEmailInput) => void,
): Promise<void> {
  const oldJobStatus = initialJob.status;
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
        latestJobEvent.statusHash === agentJobStatus.statusHash;

      if (!hasUnchangedStatusHash) {
        const inputSchemaData = agentJobStatus.input_schema;
        const inputSchemaValue = inputSchemaData
          ? JSON.stringify(inputSchemaData)
          : undefined;

        const newJobEvent = await jobEventRepository.createJobEventForJobId(
          initialJob.id,
          {
            status: jobStatusToAgentJobStatus(
              agentJobStatus.status as JobStatusValue,
            ),
            inputSchema: inputSchemaValue,
            result: agentJobStatus.result,
            statusHash: agentJobStatus.statusHash,
          },
          tx,
        );

        const refreshedJob = await jobRepository.getJobById(initialJob.id, tx);
        if (!refreshedJob) {
          throw new Error("Job not found");
        }
        currentJob = refreshedJob;

        const outputResult = agentJobStatus.result;
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

  await finalizeJobSyncResult(oldJobStatus, transactionResult, enqueueEmail);
}
