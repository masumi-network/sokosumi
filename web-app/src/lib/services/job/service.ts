"use server";

import { v4 as uuidv4 } from "uuid";

import { getPaymentClient } from "@/lib/api/payment-service.client";
import {
  createJob,
  getAgentById,
  getJobByIdWithCreditTransaction,
  JobErrorNoteKeys,
  prisma,
  updateJobStatusToCompleted,
  updateJobStatusToFailed,
  updateJobStatusToRefunded,
} from "@/lib/db";
import { JobInputData } from "@/lib/job-input";
import { calculateInputHash } from "@/lib/utils";
import { Job, JobStatus } from "@/prisma/generated/client";
import { getAgentPricing } from "@/services/agent.service";
import {
  getCreditsPrice,
  validateCreditsBalance,
} from "@/services/credit.service";

import {
  createPurchase,
  getAgentJobStatus,
  getPurchaseOnChainState,
  startAgentJob,
} from "./third-party";

export async function startJob(
  userId: string,
  agentId: string,
  maxAcceptedCents: bigint,
  inputData: JobInputData,
): Promise<Job> {
  return await prisma.$transaction(
    async (tx) => {
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

      const paymentClient = getPaymentClient();
      const createPurchaseResult = await createPurchase(
        paymentClient,
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
          jobStatus: JobStatus.PAYMENT_PENDING,
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

export async function syncJobStatus(job: Job) {
  const agent = await getAgentById(job.agentId);

  if (!agent) {
    throw new Error("Agent not found");
  }
  const paymentClient = getPaymentClient();
  const onChainStateResult = await getPurchaseOnChainState(
    paymentClient,
    job.paymentId,
  );
  if (!onChainStateResult.ok) {
    await updateJobStatusToFailed(
      job.id,
      onChainStateResult.error,
      JobErrorNoteKeys.SyncStatusFailed,
    );
    throw new Error("Failed to get on-chain status");
  }
  const onChainState = onChainStateResult.data;

  if (onChainState === null || onChainState === "FundsLocked") {
    console.warn("Funds still in locked state");
    return;
  }

  if (onChainState === "ResultSubmitted" || onChainState == "Withdrawn") {
    const jobStatusResult = await getAgentJobStatus(agent, job.agentJobId);
    if (!jobStatusResult.ok) {
      await updateJobStatusToFailed(
        job.id,
        jobStatusResult.error,
        JobErrorNoteKeys.SyncOutputFailed,
      );
      throw new Error("Failed to get on-chain status");
    }

    const jobStatusResponse = jobStatusResult.data;
    //TODO: validate the schema of the output
    if (jobStatusResponse.error) {
      await updateJobStatusToFailed(
        job.id,
        jobStatusResponse.error,
        "Job.SyncOutputFailed",
      );
      throw new Error("Failed to get output");
    }

    const output = JSON.stringify(jobStatusResponse);
    await updateJobStatusToCompleted(job.id, output);
    return;
  }

  if (onChainState === "RefundWithdrawn") {
    await prisma.$transaction(async (tx) => {
      const jobToRefund = await getJobByIdWithCreditTransaction(job.id, tx);
      if (!jobToRefund) {
        throw new Error("Job to Refund not found");
      }
      const creditTransaction = jobToRefund.creditTransaction;

      await updateJobStatusToRefunded(
        job.id,
        jobToRefund.userId,
        creditTransaction,
        tx,
      );
    });
    return;
  }
  await updateJobStatusToFailed(
    job.id,
    "Unknown on-chain state: " + onChainState,
    "Job.ManualChainState",
  );
}
