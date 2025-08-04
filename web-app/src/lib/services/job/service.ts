import "server-only";

import { JobStatusData } from "@/lib/ably";
import publishJobStatusData from "@/lib/ably/publish";
import { getSessionOrThrow } from "@/lib/auth/utils";
import { agentClient } from "@/lib/clients";
import { paymentClient } from "@/lib/clients/masumi-payment.client";
import { computeJobStatus, getJobStatusData, JobStatus } from "@/lib/db";
import { agentRepository, jobRepository, prisma } from "@/lib/db/repositories";
import {
  AgentJobStatus,
  Job,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

function shouldSyncAgentStatus(job: Job): boolean {
  if (job.refundedCreditTransactionId) {
    return false;
  }
  if (
    job.onChainStatus === OnChainJobStatus.RESULT_SUBMITTED &&
    job.agentJobStatus === AgentJobStatus.COMPLETED
  ) {
    return false;
  }
  return true;
}

function shouldSyncMasumiStatus(job: Job): boolean {
  return job.refundedCreditTransactionId === null;
}

export async function syncJob(job: Job) {
  const oldJobStatus = computeJobStatus(job);
  if (!job.purchaseId) {
    const purchaseResult =
      await paymentClient.getPurchaseByBlockchainIdentifier(
        job.blockchainIdentifier,
      );
    if (purchaseResult.ok) {
      job = await jobRepository.updateJobWithPurchase(
        job.id,
        purchaseResult.data,
      );
    }
  }
  const [agentJobStatus, onChainPurchase] = await Promise.all([
    shouldSyncAgentStatus(job) ? getAgentJobStatus(job) : null,
    shouldSyncMasumiStatus(job) ? getOnChainPurchase(job.purchaseId) : null,
  ]);

  const newJobStatus = await prisma.$transaction(
    async (tx) => {
      if (onChainPurchase) {
        job = await syncRegistryStatus(job, onChainPurchase, tx);
      }
      if (agentJobStatus) {
        job = await syncAgentJobStatus(job, agentJobStatus, tx);
      }
      const jobStatus = computeJobStatus(job);
      switch (jobStatus) {
        case JobStatus.PAYMENT_FAILED:
        case JobStatus.REFUND_RESOLVED:
          await jobRepository.refundJob(job.id, tx);
          break;
        default:
          break;
      }
      return jobStatus;
    },
    {
      maxWait: 5000, // default: 2000
      timeout: 20000, // default: 5000
    },
  );

  // if job status changed, publish to job status to channel
  if (newJobStatus !== oldJobStatus) {
    console.log(
      `Job ${job.id} status changed from ${oldJobStatus} to ${newJobStatus}`,
    );

    try {
      await publishJobStatusData(job);
    } catch (err) {
      console.error("Error publishing job status data", err);
    }
  }
}

async function syncRegistryStatus(
  job: Job,
  purchase: Purchase,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  try {
    return await jobRepository.updateJobWithPurchase(job.id, purchase, tx);
  } catch {
    console.log("Error syncing registry status: ", job.id);
    return job;
  }
}

async function syncAgentJobStatus(
  job: Job,
  jobStatusResponse: JobStatusResponse,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  try {
    return await jobRepository.updateJobWithAgentJobStatus(
      job,
      jobStatusResponse,
      tx,
    );
  } catch {
    console.log("Error syncing agent job status: ", job.id);
    return job;
  }
}

async function getOnChainPurchase(
  jobPurchaseId: string | null,
): Promise<Purchase | null> {
  if (jobPurchaseId === null) {
    return null;
  }
  const purchaseResult = await paymentClient.getPurchaseById(jobPurchaseId);
  if (!purchaseResult.ok) {
    return null;
  }
  return purchaseResult.data;
}

export async function getAgentJobStatus(
  job: Job,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobStatusResponse | null> {
  const agent = await agentRepository.getAgentWithRelationsById(
    job.agentId,
    tx,
  );
  if (!agent) {
    return null;
  }
  const jobStatusResult = await agentClient.fetchAgentJobStatus(
    agent,
    job.agentJobId,
  );
  if (!jobStatusResult.ok) {
    return null;
  }
  return jobStatusResult.data;
}

/**
 * Get the latest job's JobStatusData for each agent
 * @param agentIds - The IDs of the agents to get the latest job status for
 * @param tx - The transaction client to use for the database operations
 * @returns The latest job's JobStatusData for each agent
 */
export async function getAgentJobStatusDataListByAgentIds(
  agentIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<(JobStatusData | null)[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

  return await Promise.all(
    agentIds.map(async (agentId) => {
      const latestJob =
        await jobRepository.getLatestJobByAgentIdUserIdAndOrganization(
          agentId,
          userId,
          activeOrganizationId,
          tx,
        );
      if (!latestJob) {
        return null;
      }
      return getJobStatusData(latestJob);
    }),
  );
}
