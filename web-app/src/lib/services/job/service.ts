"use server";

import { v4 as uuidv4 } from "uuid";

import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  computeJobStatus,
  createJob,
  getAgentById,
  getJobsByAgentIdAndUserId,
  JobStatus,
  JobWithStatus,
  prisma,
  refundJob,
  setNextActionToJob,
  updateJobWithAgentJobStatus,
  updateJobWithPurchase,
} from "@/lib/db";
import { calculateInputHash } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";
import { getAgentPricing } from "@/services/agent";
import { getCreditsPrice, validateCreditsBalance } from "@/services/credit";

import { StartJobInputSchemaType } from "./schemas";
import {
  createPurchase,
  fetchAgentJobStatus,
  getPaymentClientPurchase,
  postPaymentClientRequestRefund,
  startAgentJob,
} from "./third-party";

export async function getMyJobsByAgentId(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const session = await getSessionOrThrow();
  return await getJobsByAgentIdAndUserId(agentId, session.user.id, tx);
}

export async function startJob(input: StartJobInputSchemaType): Promise<Job> {
  return await prisma.$transaction(
    async (tx) => {
      const { userId, agentId, maxAcceptedCents, inputData } = input;

      const agent = await getAgentById(agentId, tx);
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
        await validateCreditsBalance(userId, creditsPrice.cents, tx);
      }

      const identifierFromPurchaser = uuidv4()
        .replace(/-/g, "")
        .substring(0, 25);
      const inputHash = calculateInputHash(inputData, identifierFromPurchaser);

      const startJobResult = await startAgentJob(
        agent,
        identifierFromPurchaser,
        inputData,
      );
      if (!startJobResult.ok) {
        throw new Error(startJobResult.error);
      }
      const startJobResponse = startJobResult.data;
      if (startJobResponse.input_hash !== inputHash) {
        throw new Error("Input data hash mismatch");
      }

      const createPurchaseResult = await createPurchase(
        agent,
        startJobResponse,
        inputData,
        inputHash,
        identifierFromPurchaser,
      );
      if (!createPurchaseResult.ok) {
        throw new Error(createPurchaseResult.error);
      }
      const purchaseResponse = createPurchaseResult.data;

      const job = await createJob(
        {
          agentJobId: startJobResponse.job_id,
          agentId,
          userId,
          input: JSON.stringify(Object.fromEntries(inputData)),
          paymentId: purchaseResponse.data.id,
          creditsPrice,
          identifierFromPurchaser,
          externalDisputeUnlockTime: new Date(
            startJobResponse.externalDisputeUnlockTime,
          ),
          submitResultTime: new Date(startJobResponse.submitResultTime),
          unlockTime: new Date(startJobResponse.unlockTime),
          blockchainIdentifier: startJobResponse.blockchainIdentifier,
          sellerVkey: startJobResponse.sellerVkey,
        },
        tx,
      );
      return job;
    },
    {
      maxWait: 5000, // default: 2000
      timeout: 10000, // default: 5000
    },
  );
}

export async function syncJob(job: Job) {
  const [agentJobStatus, onChainPurchase] = await Promise.all([
    getAgentJobStatus(job),
    getOnChainPurchase(job.paymentId),
  ]);

  await prisma.$transaction(
    async (tx) => {
      if (onChainPurchase) {
        job = await syncRegistryStatus(job, onChainPurchase, tx);
      }
      if (agentJobStatus) {
        job = await syncAgentJobStatus(job, agentJobStatus, tx);
      }
      // Refund if the job failed
      const jobStatus = computeJobStatus(job);
      switch (jobStatus) {
        case JobStatus.PAYMENT_FAILED:
        case JobStatus.REFUND_RESOLVED:
          await refundJob(job.id, tx);
          break;
        default:
          break;
      }

      // Request a refund if the job is not completed after 10 minutes
      switch (job.onChainStatus) {
        case OnChainJobStatus.RESULT_SUBMITTED:
          if (job.agentJobStatus !== AgentJobStatus.COMPLETED) {
            const resultSubmittedAt = job.resultSubmittedAt;
            if (!resultSubmittedAt) {
              await postPaymentClientRequestRefund(job.blockchainIdentifier);
            } else if (
              new Date().getTime() - resultSubmittedAt.getTime() >
              10 * 60 * 1000 // 10 minutes
            ) {
              await postPaymentClientRequestRefund(job.blockchainIdentifier);
            }
          }
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
  jobPaymentId: string,
): Promise<Purchase | null> {
  const purchaseResult = await getPaymentClientPurchase(jobPaymentId);
  if (!purchaseResult.ok) {
    return null;
  }
  return purchaseResult.data;
}

export async function getAgentJobStatus(
  job: Job,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobStatusResponse | null> {
  const agent = await getAgentById(job.agentId, tx);
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
  const job = await setNextActionToJob(
    jobBlockchainIdentifier,
    NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
  );
  return job;
}
