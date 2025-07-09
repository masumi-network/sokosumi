import "server-only";

import { v4 as uuidv4 } from "uuid";

import { getActiveOrganizationId, getSessionOrThrow } from "@/lib/auth/utils";
import { computeJobStatus, JobStatus, JobWithStatus } from "@/lib/db";
import {
  createJob,
  prisma,
  refundJob,
  retrieveAgentWithRelationsById,
  retrieveJobsByAgentIdUserIdAndOrganizationId,
  retrieveNotFinalizedLatestJobByAgentIdUserIdAndOrganization,
  retrievePersonalJobsByAgentIdAndUserId,
  updateJobNextActionByBlockchainIdentifier,
  updateJobWithAgentJobStatus,
  updateJobWithPurchase,
} from "@/lib/db/repositories";
import { generateJobName } from "@/lib/generateJobName";
import { JobInputData } from "@/lib/job-input";
import { StartJobInputSchemaType } from "@/lib/schemas";
import { getInputHash, getInputHashDeprecated } from "@/lib/utils";
import { Job, NextJobAction, Prisma } from "@/prisma/generated/client";
import { getAgentPricing } from "@/services/agent";
import {
  getCreditsPrice,
  validateCreditsBalance,
  validateOrganizationCreditsBalance,
} from "@/services/credit";

import {
  createPurchase,
  fetchAgentJobStatus,
  getPaymentClientPurchase,
  postPaymentClientRequestRefund,
  startAgentJob,
} from "./third-party";

function getMatchedInputHash(
  inputData: JobInputData,
  identifierFromPurchaser: string,
  inputHashToMatch: string,
): string {
  const inputHash = getInputHash(inputData, identifierFromPurchaser);
  if (inputHashToMatch === inputHash) {
    return inputHash;
  }
  const inputHashDeprecated = getInputHashDeprecated(
    inputData,
    identifierFromPurchaser,
  );
  if (inputHashToMatch === inputHashDeprecated) {
    return inputHashDeprecated;
  }
  throw new Error("Input data hash mismatch");
}

export async function getMyJobsByAgentId(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

  if (activeOrganizationId) {
    // Show jobs for the specific organization
    return await retrieveJobsByAgentIdUserIdAndOrganizationId(
      agentId,
      userId,
      activeOrganizationId,
      tx,
    );
  } else {
    // Show personal jobs only (without organization context)
    return await retrievePersonalJobsByAgentIdAndUserId(agentId, userId, tx);
  }
}

export async function startJob(input: StartJobInputSchemaType): Promise<Job> {
  const { userId, agentId, maxAcceptedCents, inputData, inputSchema } = input;
  const organizationId = await getActiveOrganizationId();
  const [agent, creditsPrice] = await prisma.$transaction(async (tx) => {
    const agent = await retrieveAgentWithRelationsById(agentId, tx);
    if (!agent) {
      throw new Error("Agent not found");
    }
    const pricing = await getAgentPricing(agentId, tx);
    const creditsPrice = await getCreditsPrice(
      pricing.FixedPricing.Amounts.map((amount) => ({
        unit: amount.unit,
        amount: Number(amount.amount),
      })),
      tx,
    );
    if (creditsPrice.cents > maxAcceptedCents) {
      throw new Error("Credit cost is too high");
    }

    if (creditsPrice.cents > 0) {
      if (organizationId) {
        await validateOrganizationCreditsBalance(
          organizationId,
          creditsPrice.cents,
          tx,
        );
      } else {
        await validateCreditsBalance(userId, creditsPrice.cents, tx);
      }
    }
    return [agent, creditsPrice];
  });

  // Start job
  const identifierFromPurchaser = uuidv4().replace(/-/g, "").substring(0, 20);

  const startJobResult = await startAgentJob(
    agent,
    identifierFromPurchaser,
    inputData,
  );
  if (!startJobResult.ok) {
    throw new Error(startJobResult.error);
  }
  const startJobResponse = startJobResult.data;
  const matchedInputHash = getMatchedInputHash(
    inputData,
    identifierFromPurchaser,
    startJobResponse.input_hash,
  );

  // Generate job name
  let generatedName: string | null;
  try {
    generatedName = await generateJobName(
      {
        name: agent.name,
        description: agent.description,
      },
      inputData,
    );
  } catch (error) {
    console.error("Failed to generate job name via Anthropic API:", error);
    generatedName = null;
  }

  // Create job
  const job = await createJob({
    agentJobId: startJobResponse.job_id,
    agentId,
    userId,
    organizationId,
    input: JSON.stringify(Object.fromEntries(inputData)),
    inputSchema: inputSchema,
    creditsPrice,
    identifierFromPurchaser,
    externalDisputeUnlockTime: new Date(
      startJobResponse.externalDisputeUnlockTime,
    ),
    payByTime: new Date(startJobResponse.payByTime),
    submitResultTime: new Date(startJobResponse.submitResultTime),
    unlockTime: new Date(startJobResponse.unlockTime),
    blockchainIdentifier: startJobResponse.blockchainIdentifier,
    sellerVkey: startJobResponse.sellerVKey,
    name: generatedName,
  });

  // Create purchase
  const createPurchaseResult = await createPurchase(
    agent,
    startJobResponse,
    inputData,
    matchedInputHash,
    identifierFromPurchaser,
  );
  if (createPurchaseResult.ok) {
    const purchase = createPurchaseResult.data.data as Purchase;
    await updateJobWithPurchase(job.id, purchase);
  }

  return job;
}

/**
 * Requests a refund for a job if certain conditions are met:
 * 1. If the current time is within 1 hour before the unlock time
 * 2. If the job result was submitted more than 10 minutes ago
 *
 * This function helps ensure timely refunds for jobs that are either
 * approaching their unlock deadline or have had results submitted
 * but may not be processing correctly.
 *
 * @param job - The job to potentially request a refund for
 */
async function requestRefundIfNeeded(job: Job) {
  let shouldRequestRefund = false;
  const currentTime = new Date();

  // Check if we're within 1 hour of unlock time
  const oneHourBeforeUnlock = new Date(
    job.unlockTime.getTime() - 60 * 60 * 1000, // 1 hour before unlock
  );

  if (currentTime >= oneHourBeforeUnlock) {
    shouldRequestRefund = true;
  }

  // Check if result was submitted more than 10 minutes ago
  const resultSubmittedAt = job.resultSubmittedAt;
  if (
    resultSubmittedAt &&
    currentTime.getTime() - resultSubmittedAt.getTime() > 10 * 60 * 1000 // 10 minutes
  ) {
    shouldRequestRefund = true;
  }

  // Only make one refund request if either condition is met
  if (shouldRequestRefund) {
    const refundResult = await postPaymentClientRequestRefund(
      job.blockchainIdentifier,
    );
    if (!refundResult.ok) {
      console.error(
        `Failed to request refund for job ${job.id}:`,
        refundResult.error,
      );
    }
  }
}

export async function syncJob(job: Job) {
  if (!job.purchaseId) {
    if (job.createdAt < new Date(Date.now() - 1000 * 60 * 1)) {
      // 1min grace period for jobs that don't have a purchase id
      await refundJob(job.id);
    }
    return;
  }

  const [agentJobStatus, onChainPurchase] = await Promise.all([
    getAgentJobStatus(job),
    getOnChainPurchase(job.purchaseId),
  ]);

  await prisma.$transaction(
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
          await refundJob(job.id, tx);
          break;
        case JobStatus.OUTPUT_PENDING:
          await requestRefundIfNeeded(job);
          break;
        default:
          break;
      }
    },
    {
      maxWait: 5000, // default: 2000
      timeout: 20000, // default: 5000
    },
  );
}

async function syncRegistryStatus(
  job: Job,
  purchase: Purchase,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  try {
    return await updateJobWithPurchase(job.id, purchase, tx);
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
    return await updateJobWithAgentJobStatus(job, jobStatusResponse, tx);
  } catch {
    console.log("Error syncing agent job status: ", job.id);
    return job;
  }
}

async function getOnChainPurchase(
  jobPurchaseId: string,
): Promise<Purchase | null> {
  const purchaseResult = await getPaymentClientPurchase(jobPurchaseId);
  if (!purchaseResult.ok) {
    return null;
  }
  return purchaseResult.data;
}

export async function getAgentJobStatus(
  job: Job,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobStatusResponse | null> {
  const agent = await retrieveAgentWithRelationsById(job.agentId, tx);
  if (!agent) {
    return null;
  }
  const jobStatusResult = await fetchAgentJobStatus(agent, job.agentJobId);
  if (!jobStatusResult.ok) {
    return null;
  }
  return jobStatusResult.data;
}

export async function requestRefundJob(
  jobBlockchainIdentifier: string,
): Promise<JobWithStatus> {
  const refundResult = await postPaymentClientRequestRefund(
    jobBlockchainIdentifier,
  );
  if (!refundResult.ok) {
    throw new Error(refundResult.error);
  }
  const job = await updateJobNextActionByBlockchainIdentifier(
    jobBlockchainIdentifier,
    NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
  );
  return job;
}

export async function getNotFinalizedLatestJobsByAgentIds(
  agentIds: string[],
  tx: Prisma.TransactionClient = prisma,
): Promise<(JobWithStatus | null)[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const activeOrganizationId = session.session.activeOrganizationId;

  return await Promise.all(
    agentIds.map((agentId) =>
      retrieveNotFinalizedLatestJobByAgentIdUserIdAndOrganization(
        agentId,
        userId,
        activeOrganizationId,
        tx,
      ),
    ),
  );
}
