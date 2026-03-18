import * as Sentry from "@sentry/node";
import { AgentJobStatus, JobType, SokosumiJobStatus } from "@sokosumi/database";
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
import { createAgentClient } from "@sokosumi/masumi";
import { err } from "neverthrow";
import pLimit from "p-limit";

import { paymentClient } from "@/clients/masumi-payment.client";
import { postmarkClient } from "@/clients/postmark.client";
import { getEnv } from "@/config/env";
import { transformPurchaseToJobUpdate } from "@/helpers/purchase";
import { publishJobStatusData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { sourceImportService } from "@/services/source-import.service";

const JOB_SYNC_CONCURRENCY = 5;
const JOB_SYNC_REMOTE_TIMEOUT_BUFFER_MS = 250;
const JOB_SYNC_REMOTE_TIMEOUT_MS = 10_000;

type JobStatusValue =
  | "awaiting_payment"
  | "awaiting_input"
  | "running"
  | "completed"
  | "failed";

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

function shouldStopSync(
  options: JobSyncExecutionOptions,
  reason: string,
): boolean {
  if (!options.shouldContinue()) {
    console.info(`[sync/jobs] ${reason}`);
    return true;
  }

  if (options.abortSignal.aborted) {
    console.info(`[sync/jobs] ${reason}`);
    return true;
  }

  if (!hasTimeRemaining(options.deadlineMs)) {
    console.info(`[sync/jobs] ${reason}`);
    return true;
  }

  return false;
}

function createPollingSignal(
  options: JobSyncExecutionOptions,
  reason: string,
): AbortSignal | null {
  if (shouldStopSync(options, reason)) {
    return null;
  }

  const remainingBudgetMs =
    options.deadlineMs - Date.now() - JOB_SYNC_REMOTE_TIMEOUT_BUFFER_MS;
  if (remainingBudgetMs <= 0) {
    console.info(`[sync/jobs] ${reason}`);
    return null;
  }

  return AbortSignal.any([
    options.abortSignal,
    AbortSignal.timeout(Math.min(remainingBudgetMs, JOB_SYNC_REMOTE_TIMEOUT_MS)),
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
  return `${getEnv().BETTER_AUTH_TRUSTED_ORIGIN}/agents/${job.agentId}/jobs/${job.id}`;
}

function shouldSyncAgentStatus(job: JobWithSokosumiStatus): string | null {
  if (job.jobType === JobType.DEMO) {
    return null;
  }
  if (job.refundedTransactionId) {
    return null;
  }
  const completedEvent = job.events.find(
    (event) => event.status === AgentJobStatus.COMPLETED,
  );
  if (completedEvent) {
    return null;
  }
  return job.agentJobId;
}

function shouldSyncMasumiStatus(job: JobWithSokosumiStatus): string | null {
  if (job.jobType === JobType.FREE || job.jobType === JobType.DEMO) {
    return null;
  }
  if (job.refundedTransactionId) {
    return null;
  }
  if (job.purchase === null) {
    return null;
  }
  return job.purchase.externalId;
}

function buildFailureNotificationData(
  job: JobWithSokosumiStatus,
): JobFailureNotificationEmailProps {
  const latestEvent = job.events.at(0);

  return {
    network: getEnv().NETWORK,
    agentId: job.agentId,
    agentBlockchainIdentifier: job.agent.blockchainIdentifier,
    agentName: job.agent.name,
    jobId: job.id,
    jobBlockchainIdentifier: job.blockchainIdentifier,
    onChainStatus: job.purchase?.onChainStatus ?? "N/A",
    agentStatus: job.status,
    result: latestEvent?.result ?? "N/A",
    resultHash: job.purchase?.resultHash ?? "N/A",
  };
}

async function dispatchFinalStatusNotification(
  job: JobWithSokosumiStatus,
  jobStatus: SokosumiJobStatus,
): Promise<void> {
  if (job.jobType === JobType.DEMO || !job.user.notificationsOptIn) {
    return;
  }

  try {
    const email = await renderJobFinalStatusEmail({
      recipientName: job.user.name,
      agentName: job.agent.name,
      jobName: job.name ?? undefined,
      jobStatus,
      jobLink: buildJobLink(job),
      locale: "en",
    });

    void postmarkClient
      .sendEmail({
        From: getEnv().POSTMARK_FROM_EMAIL,
        To: job.user.email,
        Tag: "job-final-status",
        Subject: email.subject,
        HtmlBody: email.html,
        MessageStream: "outbound",
      })
      .catch((error) => {
        Sentry.captureException(error, {
          extra: {
            jobId: job.id,
            userId: job.userId,
            notificationType: "job-final-status",
          },
        });
      });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.userId,
        notificationType: "job-final-status",
      },
    });
  }
}

async function dispatchInputRequiredNotification(
  job: JobWithSokosumiStatus,
): Promise<void> {
  if (job.jobType === JobType.DEMO || !job.user.notificationsOptIn) {
    return;
  }

  try {
    const email = await renderJobInputRequiredEmail({
      recipientName: job.user.name,
      agentName: job.agent.name,
      jobName: job.name ?? undefined,
      jobLink: buildJobLink(job),
      locale: "en",
    });

    void postmarkClient
      .sendEmail({
        From: getEnv().POSTMARK_FROM_EMAIL,
        To: job.user.email,
        Tag: "job-input-required",
        Subject: email.subject,
        HtmlBody: email.html,
        MessageStream: "outbound",
      })
      .catch((error) => {
        Sentry.captureException(error, {
          extra: {
            jobId: job.id,
            userId: job.userId,
            notificationType: "job-input-required",
          },
        });
      });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.userId,
        notificationType: "job-input-required",
      },
    });
  }
}

async function dispatchJobFailureNotification(
  job: JobWithSokosumiStatus,
): Promise<void> {
  if (job.jobType === JobType.DEMO) {
    return;
  }

  try {
    const notificationData = buildFailureNotificationData(job);
    const webhookUrl = getEnv().JOB_FAILURE_WEBHOOK_URL;

    if (webhookUrl) {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notificationData),
      });

      void fetch(request).catch((error) => {
        Sentry.captureException(error, {
          extra: {
            jobId: job.id,
            userId: job.userId,
            notificationType: "job-failure-webhook",
          },
        });
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

    void postmarkClient
      .sendEmail({
        From: getEnv().POSTMARK_FROM_EMAIL,
        To: toRecipients.join(","),
        ...(bccRecipients && { Bcc: bccRecipients.join(",") }),
        Tag: "job-failure-notification",
        Subject: email.subject,
        HtmlBody: email.html,
        MessageStream: "outbound",
      })
      .catch((error) => {
        Sentry.captureException(error, {
          extra: {
            jobId: job.id,
            userId: job.userId,
            notificationType: "job-failure-email",
          },
        });
      });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        jobId: job.id,
        userId: job.userId,
        notificationType: "job-failure",
      },
    });
  }
}

async function syncSingleJob(
  initialJob: JobWithSokosumiStatus,
  options: JobSyncExecutionOptions,
): Promise<boolean> {
  const oldJobStatus = initialJob.status;
  const job = initialJob;

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
      shouldStopSync(options, `Stopping after backfilling purchase for job ${job.id}`)
    ) {
      return false;
    }

    if (purchaseResult.isOk()) {
      const purchaseData = transformPurchaseToJobUpdate(purchaseResult.value);
      await jobPurchaseRepository.createJobPurchase(
        {
          jobId: job.id,
          ...purchaseData,
        },
        prisma,
      );

      return true;
    }
  }

  const agentJobIdToSync = shouldSyncAgentStatus(job);
  const purchaseIdToSync = shouldSyncMasumiStatus(job);
  const pollingSignal = createPollingSignal(
    options,
    `Stopping before polling remote status for job ${job.id}`,
  );
  if (!pollingSignal) {
    return false;
  }

  const [agentJobStatusResult, onChainPurchaseResult] = await Promise.all([
    agentJobIdToSync
      ? createAgentClient().fetchAgentJobStatus(job.agent, agentJobIdToSync, {
          signal: pollingSignal,
        })
      : Promise.resolve(err("No agent job ID to sync")),
    purchaseIdToSync
      ? paymentClient().getPurchaseById(purchaseIdToSync, {
          signal: pollingSignal,
        })
      : Promise.resolve(err("No purchase ID to sync")),
  ]);
  if (
    pollingSignal.aborted ||
    shouldStopSync(options, `Stopping after polling remote status for job ${job.id}`)
  ) {
    return false;
  }

  const transactionResult = await prisma.$transaction(
    async (
      tx,
    ): Promise<{
      extractionContext?: { eventId: string; result: string; userId: string };
      job: JobWithSokosumiStatus;
      jobStatus: SokosumiJobStatus;
    }> => {
      let extractionContext:
        | { eventId: string; result: string; userId: string }
        | undefined;
      let currentJob = job;

      if (onChainPurchaseResult.isOk()) {
        const purchaseData = transformPurchaseToJobUpdate(
          onChainPurchaseResult.value,
        );
        await jobPurchaseRepository.updateJobPurchaseByJobId(
          currentJob.id,
          purchaseData,
          tx,
        );

        const refreshedJob = await jobRepository.getJobById(currentJob.id, tx);
        if (!refreshedJob) {
          throw new Error("Job not found");
        }
        currentJob = refreshedJob;
      }

      if (agentJobStatusResult.isOk()) {
        const latestJobEvent =
          await jobEventRepository.getLatestJobEventByJobId(currentJob.id, tx);

        const hasUnchangedStatusHash =
          latestJobEvent?.statusHash &&
          latestJobEvent.statusHash === agentJobStatusResult.value.statusHash;

        if (!hasUnchangedStatusHash) {
          const inputSchemaData = agentJobStatusResult.value.input_schema;
          const inputSchemaValue = inputSchemaData
            ? JSON.stringify(inputSchemaData)
            : undefined;

          const newJobEvent = await jobEventRepository.createJobEventForJobId(
            currentJob.id,
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

          const refreshedJob = await jobRepository.getJobById(currentJob.id, tx);
          if (!refreshedJob) {
            throw new Error("Job not found");
          }
          currentJob = refreshedJob;

          const outputResult = agentJobStatusResult.value.result;
          if (typeof outputResult === "string") {
            extractionContext = {
              eventId: newJobEvent.id,
              result: outputResult,
              userId: currentJob.userId,
            };
          }
        }
      }

      if (
        currentJob.status === SokosumiJobStatus.PAYMENT_FAILED ||
        currentJob.status === SokosumiJobStatus.REFUND_RESOLVED
      ) {
        await jobRepository.refundJob(currentJob.id, tx);
      }

      return {
        job: currentJob,
        jobStatus: currentJob.status,
        extractionContext,
      };
    },
    {
      maxWait: 5000,
      timeout: 20_000,
    },
  );

  const updatedJob = transactionResult.job;

  if (transactionResult.extractionContext) {
    const { eventId, result, userId } = transactionResult.extractionContext;
    sourceImportService
      .enqueueFromMarkdown(userId, eventId, result)
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
    return true;
  }

  switch (newJobStatus) {
    case SokosumiJobStatus.COMPLETED:
    case SokosumiJobStatus.REFUND_RESOLVED:
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      await dispatchFinalStatusNotification(updatedJob, newJobStatus);
      break;
    case SokosumiJobStatus.INPUT_REQUIRED:
      await dispatchInputRequiredNotification(updatedJob);
      break;
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
      await dispatchJobFailureNotification(updatedJob);
      break;
    default:
      break;
  }

  try {
    await publishJobStatusData({
      agentId: updatedJob.agentId,
      userId: updatedJob.userId,
      jobId: updatedJob.id,
      jobStatus: updatedJob.status,
      jobStatusSettled: updatedJob.jobStatusSettled,
    });
  } catch (error) {
    console.error("Error publishing job status data", error);
  }

  return true;
}

export const jobSyncService = {
  async syncUnfinishedJobs(
    options: JobSyncExecutionOptions,
  ): Promise<JobSyncResult> {
    const startedAt = Date.now();
    const jobs = await jobRepository.getJobsNotFinished(prisma);
    const limit = pLimit(JOB_SYNC_CONCURRENCY);
    const tasks: Promise<boolean>[] = [];

    for (const job of jobs) {
      if (
        shouldStopSync(
          options,
          "Stopping before scheduling more unfinished jobs",
        )
      ) {
        break;
      }

      tasks.push(
        limit(async () => {
          if (
            shouldStopSync(options, `Stopping before processing job ${job.id}`)
          ) {
            return false;
          }

          try {
            return await syncSingleJob(job, options);
          } catch (error) {
            console.error(`Failed to sync job ${job.id}`, error);
            Sentry.captureException(error, {
              extra: {
                jobId: job.id,
              },
            });
          }
          return true;
        }),
      );
    }

    const results = await Promise.allSettled(tasks);
    const processed = results.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length;

    return {
      durationMs: Date.now() - startedAt,
      processed,
      unfinishedFound: jobs.length,
    };
  },
};
