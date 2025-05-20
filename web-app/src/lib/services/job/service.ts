"use server";

import { v4 as uuidv4 } from "uuid";

import {
  computeJobStatus,
  connectTransaction,
  createJob,
  getAgentById,
  JobStatus,
  jobStatusToAgentJobStatus,
  nextActionToNextJobAction,
  onChainStateToOnChainJobStatus,
  prisma,
  refundJob,
  transactionStatusToOnChainTransactionStatus,
  updateAgentJobStatus,
  updateNextAction,
  updateOnChainStatus,
} from "@/lib/db";
import { calculateInputHash } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
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
  await prisma.$transaction(async (tx) => {
    job = await syncRegistryStatus(job, tx);
    job = await syncAgentJobStatus(job, tx);

    const jobStatus = computeJobStatus(job);
    switch (jobStatus) {
      case JobStatus.PAYMENT_FAILED:
      case JobStatus.REFUND_RESOLVED:
        await refundJob(job.id, tx);
        break;
      default:
        break;
    }
    switch (job.onChainStatus) {
      case OnChainJobStatus.RESULT_SUBMITTED:
        const completedAt = job.completedAt ?? new Date();
        if (
          job.agentJobStatus !== AgentJobStatus.COMPLETED &&
          new Date().getTime() - completedAt.getTime() > 10 * 60 * 1000 // 10 minutes
        ) {
          await postPaymentClientRequestRefund(job);
        }
        break;
      default:
        break;
    }
  });
}

async function syncRegistryStatus(
  job: Job,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  const purchaseResult = await getPaymentClientPurchase(job.paymentId);
  if (!purchaseResult.ok) {
    return job;
  }
  const purchase = purchaseResult.data;

  const onChainStatus = onChainStateToOnChainJobStatus(purchase.onChainState);
  let newJob =
    onChainStatus !== null
      ? await updateOnChainStatus(job.id, onChainStatus, tx)
      : job;

  const nextAction = nextActionToNextJobAction(purchase.NextAction);
  newJob = await updateNextAction(
    job.id,
    nextAction.requestedAction,
    nextAction.errorType,
    nextAction.errorNote,
    tx,
  );

  // Transaction
  const transaction = purchase.CurrentTransaction;
  if (transaction) {
    newJob = await connectTransaction(
      job.id,
      transaction.txHash,
      transactionStatusToOnChainTransactionStatus(transaction.status),
    );
  }

  return newJob;
}

async function syncAgentJobStatus(
  job: Job,
  tx: Prisma.TransactionClient,
): Promise<Job> {
  const agent = await getAgentById(job.agentId, tx);

  if (!agent) {
    return job;
  }

  const jobStatusResult = await fetchAgentJobStatus(agent, job.agentJobId);
  if (!jobStatusResult.ok) {
    return job;
  }
  const jobStatusResponse = jobStatusResult.data;

  let output: string | null = null;
  if (jobStatusResponse.status === "completed") {
    output = JSON.stringify(jobStatusResponse);
  }

  return await updateAgentJobStatus(
    job.id,
    jobStatusToAgentJobStatus(jobStatusResponse.status),
    output,
    tx,
  );
}
