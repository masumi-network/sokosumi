"use server";

import { v4 as uuidv4 } from "uuid";

import {
  createJob,
  getAgentById,
  getCreditTransactionByJobId,
  JobErrorNoteKeys,
  prisma,
  updateJobStatusToAgentConnectionFailed,
  updateJobStatusToCompleted,
  updateJobStatusToDisputeRequested,
  updateJobStatusToDisputeResolved,
  updateJobStatusToFailed,
  updateJobStatusToInputRequired,
  updateJobStatusToPaymentFailed,
  updateJobStatusToPaymentNodeConnectionFailed,
  updateJobStatusToPaymentPending,
  updateJobStatusToProcessing,
  updateJobStatusToRefundRequested,
  updateJobStatusToRefundResolved,
  updateJobStatusToUnknown,
} from "@/lib/db";
import { calculateInputHash } from "@/lib/utils";
import { Job, JobStatus } from "@/prisma/generated/client";
import { getAgentPricing } from "@/services/agent";
import { getCreditsPrice, validateCreditsBalance } from "@/services/credit";

import { StartJobInputSchemaType } from "./schemas";
import {
  createPurchase,
  fetchAgentJobStatus,
  getPurchaseOnChainState,
  startAgentJob,
} from "./third-party";

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

  // get purchase on chain state
  const onChainStateResult = await getPurchaseOnChainState(job.paymentId);
  if (!onChainStateResult.ok) {
    await updateJobStatusToPaymentNodeConnectionFailed(job.id);
    throw new Error("Failed to get payment on-chain status");
  }
  const onChainState = onChainStateResult.data.onChainState;
  const errorType = onChainStateResult.data.errorType;

  // get the job status from the agent
  const jobStatusResult = await fetchAgentJobStatus(agent, job.agentJobId);
  if (!jobStatusResult.ok) {
    await updateJobStatusToAgentConnectionFailed(job.id);
    throw new Error("Failed to get job status");
  }
  const jobStatusResponse = jobStatusResult.data;

  switch (onChainState) {
    case null: {
      if (errorType === null) {
        await updateJobStatusToPaymentPending(job.id);
      } else {
        await prisma.$transaction(async (tx) => {
          const creditTransaction = await getCreditTransactionByJobId(
            job.id,
            tx,
          );
          if (!creditTransaction) {
            throw new Error("Credit transaction not found");
          }
          await updateJobStatusToPaymentFailed(
            job.id,
            creditTransaction,
            errorType,
            tx,
          );
        });
      }
      break;
    }
    case "FundsLocked": {
      if (jobStatusResponse.status === "running") {
        await updateJobStatusToProcessing(job.id);
      }
      if (jobStatusResponse.status === "awaiting_input") {
        await updateJobStatusToInputRequired(job.id);
      }
      if (jobStatusResponse.status === "failed") {
        await updateJobStatusToFailed(job.id);
      }
      break;
    }
    case "RefundRequested": {
      await updateJobStatusToRefundRequested(job.id);
      break;
    }
    case "RefundWithdrawn": {
      await prisma.$transaction(async (tx) => {
        const creditTransaction = await getCreditTransactionByJobId(job.id, tx);
        if (!creditTransaction) {
          throw new Error("Credit transaction not found");
        }
        await updateJobStatusToRefundResolved(job.id, creditTransaction, tx);
      });
      break;
    }
    case "Disputed": {
      await updateJobStatusToDisputeRequested(job.id);
      break;
    }
    case "DisputedWithdrawn": {
      await updateJobStatusToDisputeResolved(job.id);
      break;
    }
    case "FundsOrDatumInvalid": {
      await prisma.$transaction(async (tx) => {
        const creditTransaction = await getCreditTransactionByJobId(job.id, tx);
        if (!creditTransaction) {
          throw new Error("Credit transaction not found");
        }
        await updateJobStatusToPaymentFailed(
          job.id,
          creditTransaction,
          errorType,
          tx,
        );
      });
      break;
    }
    case "ResultSubmitted":
    case "Withdrawn": {
      if (jobStatusResponse.status === "completed") {
        const output = JSON.stringify(jobStatusResponse);
        await updateJobStatusToCompleted(job.id, output);
      } else if (jobStatusResponse.status === "failed") {
        await updateJobStatusToFailed(job.id);
      } else {
        await updateJobStatusToUnknown(
          job.id,
          `Job status is ${jobStatusResponse.status} with on-chain state ${onChainState}`,
          JobErrorNoteKeys.StatusMismatch,
        );
      }
      break;
    }
    default: {
      await updateJobStatusToUnknown(
        job.id,
        `Unknown on-chain state ${onChainState}`,
        JobErrorNoteKeys.Unknown,
      );
      break;
    }
  }
}
