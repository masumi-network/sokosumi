"use server";

import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { getPurchase, postPurchase } from "@/lib/api/generated/payment";
import { getPaymentClient } from "@/lib/api/payment-service.client";
import {
  createJob,
  getAgentApiBaseUrl,
  getAgentById,
  getJobByIdWithCreditTransaction,
  prisma,
  updateJobStatusToCompleted,
  updateJobStatusToFailed,
  updateJobStatusToRefunded,
} from "@/lib/db";
import { calculatedInputHash } from "@/lib/utils";
import { Job, JobStatus } from "@/prisma/generated/client";

import { getAgentPricing } from "./agent.service";
import { getCreditsPrice, validateCreditsBalance } from "./credit.service";

const startJobSchema = z.object({
  input_hash: z.string(),
  job_id: z.string(),
  sellerVkey: z.string(),
  blockchainIdentifier: z.string(),
  submitResultTime: z.number({ coerce: true }).int(),
  unlockTime: z.number({ coerce: true }).int(),
  externalDisputeUnlockTime: z.number({ coerce: true }).int(),
});

export async function startJob(
  userId: string,
  agentId: string,
  maxAcceptedCents: bigint,
  inputData: Map<string, string | number | boolean | number[]>,
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
      const baseUrl = getAgentApiBaseUrl(agent);
      const startJobUrl = new URL(`/start_job`, baseUrl);
      const identifierFromPurchaser = uuidv4()
        .replace(/-/g, "")
        .substring(0, 25);

      const inputHash = calculatedInputHash(inputData, identifierFromPurchaser);

      const result = await fetch(startJobUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier_from_purchaser: identifierFromPurchaser,
          input_data: Object.fromEntries(inputData),
        }),
      });
      if (!result.ok) {
        throw new Error("Failed to start job");
      }

      const startJobResponseData = startJobSchema.safeParse(
        await result.json(),
      );
      if (!startJobResponseData.success) {
        throw new Error("Failed to parse start job response");
      }

      const startJobResponse = startJobResponseData.data;
      if (startJobResponse.input_hash !== inputHash) {
        throw new Error("Input data hash mismatch");
      }

      const paymentClient = getPaymentClient();
      const purchaseRequest = await postPurchase({
        client: paymentClient,
        body: {
          agentIdentifier: agent.blockchainIdentifier,
          inputHash: inputHash,
          blockchainIdentifier: startJobResponse.blockchainIdentifier,
          network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
          sellerVkey: startJobResponse.sellerVkey,
          paymentType: "Web3CardanoV1",
          identifierFromPurchaser,
          externalDisputeUnlockTime:
            startJobResponse.externalDisputeUnlockTime.toString(),
          submitResultTime: startJobResponse.submitResultTime.toString(),
          unlockTime: startJobResponse.unlockTime.toString(),
          metadata: JSON.stringify({
            inputData: Object.fromEntries(inputData),
            jobId: startJobResponse.job_id,
          }),
        },
      });
      if (purchaseRequest.error || !purchaseRequest.data) {
        throw new Error("Failed to create purchase request");
      }

      const purchaseResponse = purchaseRequest.data;
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

  const purchase = await getPurchase({
    client: paymentClient,
    query: {
      cursorId: job.paymentId,
      network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
      limit: 1,
    },
  });

  if (
    purchase.error ||
    !purchase.data ||
    purchase.data.data.Purchases.length != 1
  ) {
    await updateJobStatusToFailed(
      job.id,
      purchase.error ? String(purchase.error) : "Unknown error",
      "Job.SyncStatusFailed",
    );
    throw new Error("Failed to get on-chain status");
  }

  const onChainState = purchase.data.data.Purchases[0].onChainState;

  if (onChainState === "FundsLocked" || onChainState == null) {
    console.warn("Funds still in locked state");
    return;
  }

  if (onChainState === "ResultSubmitted" || onChainState == "Withdrawn") {
    const baseUrl = getAgentApiBaseUrl(agent);
    const syncJobUrl = new URL(`/status`, baseUrl);
    syncJobUrl.searchParams.set("job_id", job.agentJobId);

    const syncJobResponse = await fetch(syncJobUrl, {
      method: "GET",
    });
    if (!syncJobResponse.ok) {
      await updateJobStatusToFailed(
        job.id,
        syncJobResponse.statusText,
        "Job.SyncOutputFailed",
      );
      throw new Error("Failed to get on-chain status");
    }

    const syncJobResponseData = await syncJobResponse.json();
    //TODO: validate the schema of the output
    if (syncJobResponseData.error) {
      await updateJobStatusToFailed(
        job.id,
        syncJobResponseData.error,
        "Job.SyncOutputFailed",
      );
      throw new Error("Failed to get output");
    }

    const output = JSON.stringify(syncJobResponseData);

    await updateJobStatusToCompleted(job.id, output);
    return;
  }
  if (onChainState === "RefundWithdrawn") {
    await prisma.$transaction(async (tx) => {
      const jobToRefund = await getJobByIdWithCreditTransaction(job.id, tx);
      if (!jobToRefund) {
        throw new Error("Job not found");
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
