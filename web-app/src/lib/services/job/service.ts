"use server";

import { v4 as uuidv4 } from "uuid";

import {
  createJob,
  getAgentById,
  jobStatusToAgentJobStatus,
  nextActionErrorTypeToNextJobActionErrorType,
  nextActionToNextJobAction,
  onChainStateToOnChainJobStatus,
  prisma,
  refundJob,
} from "@/lib/db";
import { calculateInputHash } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
  OnChainJobStatus,
} from "@/prisma/generated/client";
import { getAgentPricing } from "@/services/agent";
import { getCreditsPrice, validateCreditsBalance } from "@/services/credit";

import { StartJobInputSchemaType } from "./schemas";
import {
  createPurchase,
  fetchAgentJobStatus,
  getPaymentClientPurchase,
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
  job = await syncOnChainJobStatus(job);
  job = await syncAgentJobStatus(job);

  switch (job.onChainStatus) {
    case null:
      if (job.nextActionErrorType !== null) {
        await refundJob(job.id);
      }
      break;
    case OnChainJobStatus.FUNDS_OR_DATUM_INVALID:
      await refundJob(job.id);
      break;
    case OnChainJobStatus.FUNDS_LOCKED:
      break;
    case OnChainJobStatus.FUNDS_WITHDRAWN:
      break;
    case OnChainJobStatus.REFUND_REQUESTED:
      break;
    case OnChainJobStatus.REFUND_WITHDRAWN:
      await refundJob(job.id);
      break;
    case OnChainJobStatus.DISPUTED:
      break;
    case OnChainJobStatus.DISPUTED_WITHDRAWN:
      // TODO: update credits, but we have missing information at the moment
      break;
    case OnChainJobStatus.RESULT_SUBMITTED:
      if (
        job.agentJobStatus !== AgentJobStatus.COMPLETED &&
        new Date().getTime() - new Date(job.updatedAt).getTime() >
          10 * 60 * 1000
      ) {
        // TODO: Request Refund if updated is older then 10 minutes
      }
      break;
  }
}

export async function syncOnChainJobStatus(job: Job): Promise<Job> {
  const purchaseResult = await getPaymentClientPurchase(job.paymentId);
  if (!purchaseResult.ok) {
    throw new Error("Failed to get payment on-chain status");
  }
  const purchase = purchaseResult.data;
  const updatedJob = await prisma.job.update({
    where: { id: job.id },
    data: {
      onChainStatus: onChainStateToOnChainJobStatus(purchase.onChainState),
      nextAction: nextActionToNextJobAction(
        purchase.NextAction.requestedAction,
      ),
      nextActionErrorType: nextActionErrorTypeToNextJobActionErrorType(
        purchase.NextAction.errorType,
      ),
      nextActionErrorNote: purchase.NextAction.errorNote,
    },
  });
  return updatedJob;
}

export async function syncAgentJobStatus(job: Job): Promise<Job> {
  const agent = await getAgentById(job.agentId);

  if (!agent) {
    throw new Error("Agent not found");
  }

  const jobStatusResult = await fetchAgentJobStatus(agent, job.agentJobId);
  if (!jobStatusResult.ok) {
    throw new Error("Failed to get job status");
  }
  const jobStatusResponse = jobStatusResult.data;

  let output: string | undefined;
  if (jobStatusResponse.status === "completed") {
    output = JSON.stringify(jobStatusResponse);
  }

  return await prisma.job.update({
    where: { id: job.id },
    data: {
      agentJobStatus: jobStatusToAgentJobStatus(jobStatusResponse.status),
      ...(output !== undefined ? { output } : {}),
    },
  });
}
