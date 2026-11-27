import * as Sentry from "@sentry/node";
import { AgentJobStatus } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import {
  jobEventRepository,
  jobPurchaseRepository,
} from "@sokosumi/database/repositories";
import {
  type JobWithSokosumiStatus,
  jobInclude,
} from "@sokosumi/database/types/job";
import type { JobFailureNotificationEmailProps } from "@sokosumi/email";
import type { PostPurchaseResponses } from "@sokosumi/masumi/clients";
import type { JobStatusResponseSchemaType } from "@sokosumi/masumi/schemas";
import { postWebhook } from "@sokosumi/net";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import type { SendEmailInput } from "@/clients/email.client";
import { WEBHOOK_TIMEOUT_MS, WEBHOOK_USER_AGENT } from "@/config/constants";
import { getEnv } from "@/config/env";
import { getAgentName } from "@/helpers/agent";
import { transformPurchaseToJobUpdate } from "@/helpers/purchase";
import { publishJobStatusData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { emitCoreError, emitCoreWarning } from "@/lib/evlog";
import { isPreprodOn, JOB_SYNC_NETWORK, type Network } from "@/lib/network";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
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
  extractionContext?: {
    eventId: string;
    result: string;
    userId: string | null;
  };
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

function buildFailureNotificationData(
  job: JobWithSokosumiStatus,
  networkLabel: string,
): JobFailureNotificationEmailProps {
  const latestEvent = job.events.at(0);

  return {
    network: networkLabel,
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

export async function dispatchJobFailureNotification(
  job: JobWithSokosumiStatus,
  network: Network,
  enqueueEmail: (input: SendEmailInput) => void,
): Promise<void> {
  try {
    const env = getEnv();
    const isPreprodJob = network === "preprod";
    const jobNetworkLabel = isPreprodJob ? "Preprod" : "Mainnet";
    const notificationData = buildFailureNotificationData(
      job,
      isPreprodOn() ? jobNetworkLabel : env.NETWORK,
    );
    const webhookUrl = isPreprodJob
      ? env.PREPROD_JOB_FAILURE_WEBHOOK_URL
      : env.JOB_FAILURE_WEBHOOK_URL;

    if (webhookUrl) {
      // Fire-and-forget: dispatch the webhook without blocking the email path.
      // waitUntil keeps delivery alive after the cron's sync completes.
      waitUntil(
        postWebhook(webhookUrl, notificationData, {
          userAgent: WEBHOOK_USER_AGENT,
          timeoutMs: WEBHOOK_TIMEOUT_MS,
        })
          .then((result) => {
            if (result.status === "failed") {
              emitCoreWarning(
                { operation: "job_failure_webhook" },
                {
                  message: "Could not deliver a job failure webhook",
                  why: "The webhook request failed",
                },
                {
                  jobId: job.id,
                  userId: job.ownerId,
                  notificationType: "job-failure-webhook",
                  webhookUrl: new URL(webhookUrl).origin,
                  responseStatus: result.httpStatus,
                  failure: messageSafeErrorFields(result.error),
                },
              );
            }
          })
          .catch(() => {
            // postWebhook never rejects; guard only against the reporter throwing.
          }),
      );
    }

    // An unset Preprod email list also disables alerts to the Agent author.
    const stakeholderEmails = (
      isPreprodJob
        ? env.PREPROD_JOB_FAILURE_NOTIFICATION_EMAILS
        : env.JOB_FAILURE_NOTIFICATION_EMAILS
    ).filter((email) => email.trim() !== "");
    if (isPreprodJob && stakeholderEmails.length === 0) {
      return;
    }
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

    const { renderJobFailureNotificationEmail } = await import(
      "@sokosumi/email"
    );
    const email = await renderJobFailureNotificationEmail({
      ...notificationData,
      ...(isPreprodJob ? { isPreprodJob } : {}),
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
        // Job sync runs only in the jobs cron, after its response.
        emitCoreError(
          {
            operation: "job_sync",
            job: { id: updatedJob.id },
            jobEvent: { id: eventId },
          },
          {
            message: "Could not queue the sources a job's result links to",
            why: "Queueing the source import from the result failed",
            fix: "The job's status is saved; only its linked sources are missing. Sentry has the error.",
          },
          // Only safe fields: the result is the agent's text, and an import
          // error can quote it.
          { failure: messageSafeErrorFields(error) },
        );
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

  // A job reaching a final status tells its owner nothing they can act on in
  // the app: SOK-803 ended in-app Hire, so a job is started through the API
  // and read there (SOK-930). The failure alert stays because its audience is
  // the agent author and the stakeholder list, not the owner (SOK-24).
  //
  // Await render+enqueue; Resend batch flush runs at end of syncUnfinishedJobs.
  switch (newJobStatus) {
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
      await dispatchJobFailureNotification(
        updatedJob,
        JOB_SYNC_NETWORK,
        enqueueEmail,
      );
      break;
    default:
      break;
  }

  // The live channel is a person's: a Job without an Owner has none.
  const ownerId = updatedJob.ownerId;
  if (!ownerId) {
    return;
  }

  try {
    await publishJobStatusData({
      agentId: updatedJob.agentId,
      userId: ownerId,
      jobId: updatedJob.id,
      jobStatus: updatedJob.status,
      jobStatusSettled: updatedJob.jobStatusSettled,
    });
  } catch (error) {
    emitCoreError(
      {
        operation: "job_sync",
        job: { id: updatedJob.id, status: updatedJob.status },
      },
      {
        message:
          "Could not publish a job's new status to its owner's live view",
        why: "Publishing the status to Ably failed",
        fix: "The status is saved; the owner sees it on the next reload.",
        cause: error,
      },
    );
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

      const refreshedJobRow = await tx.job.findUnique({
        where: { id: job.id },
        include: jobInclude,
      });
      if (!refreshedJobRow) {
        throw new Error("Job not found");
      }
      const refreshedJob = mapJobWithStatus(refreshedJobRow);

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
      let extractionContext: JobSyncTransactionResult["extractionContext"];

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

        const refreshedJobRow = await tx.job.findUnique({
          where: { id: initialJob.id },
          include: jobInclude,
        });
        if (!refreshedJobRow) {
          throw new Error("Job not found");
        }
        currentJob = mapJobWithStatus(refreshedJobRow);

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
