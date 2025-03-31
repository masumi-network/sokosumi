import crypto from "crypto";
import { z } from "zod";

import { getEnvSecrets } from "@/config/env.config";
import { postPurchase } from "@/lib/api/generated/payment";
import prisma from "@/lib/db/prisma";

import { getAgentById } from "./agent.service";
import {
  calculateCreditCostAndValidateAmounts,
  creditActionSpend,
} from "./credit.service";

const startJobSchema = z.object({
  inputDataHash: z.string(),
  jobId: z.string(),
  sellerVkey: z.string(),
  blockchainIdentifier: z.string(),
  submitResultTime: z.string(),
  unlockTime: z.string(),
  externalDisputeUnlockTime: z.string(),
});

export async function startJob(
  userId: string,
  agentId: string,
  amounts: { unit: string; amount: number }[],
  inputData: { key: string; value: string }[],
) {
  const agent = await getAgentById(agentId);

  if (!agent) {
    throw new Error("Agent not found");
  }

  const creditCost = await calculateCreditCostAndValidateAmounts(
    amounts,
    getEnvSecrets().DEFAULT_NETWORK_FEE_PERCENTAGE,
  );

  const creditAction = await creditActionSpend(userId, creditCost, BigInt(0));

  try {
    const baseUrl = agent.apiBaseUrl;
    //start_job to the base url
    const startJobUrl = new URL(`${baseUrl}/start_job`);
    const identifierFromPurchaser = crypto.randomUUID();
    const inputHash = calculatedInputHash(inputData);
    const result = await fetch(startJobUrl, {
      method: "POST",
      body: JSON.stringify({
        identifierFromPurchaser,
        inputData,
      }),
    });
    if (!result.ok) {
      throw new Error("Failed to start job");
    }
    const startJobResponse = startJobSchema.parse(await result.json());
    if (startJobResponse.inputDataHash !== inputHash) {
      throw new Error("Input data hash mismatch");
    }

    const purchaseRequest = await postPurchase({
      body: {
        agentIdentifier: agent.onChainIdentifier,
        inputHash: inputHash,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
        network: "Preprod",
        sellerVkey: startJobResponse.sellerVkey,
        paymentType: "Web3CardanoV1",
        identifierFromPurchaser,
        externalDisputeUnlockTime: startJobResponse.externalDisputeUnlockTime,
        submitResultTime: startJobResponse.submitResultTime,
        unlockTime: startJobResponse.unlockTime,
        metadata: JSON.stringify({
          inputData,
          jobId: startJobResponse.jobId,
        }),
      },
    });
    if (purchaseRequest.error || !purchaseRequest.data) {
      throw new Error("Failed to create purchase request");
    }

    const purchaseResponse = purchaseRequest.data;
    const job = await prisma.job.create({
      data: {
        agentJobId: startJobResponse.jobId,
        onChainIdentifier: startJobResponse.blockchainIdentifier,
        agent: {
          connect: {
            id: agentId,
          },
        },
        cost: {
          connect: {
            id: creditAction.id,
          },
        },
        status: "PAYMENT_PENDING",
        paymentId: purchaseResponse.data.id,
        input: JSON.stringify(inputData),
        user: {
          connect: {
            id: userId,
          },
        },
      },
    });
    await prisma.creditAction.update({
      where: {
        id: creditAction.id,
      },
      data: {
        status: "Succeeded",
      },
    });

    return job;
  } catch (error) {
    await prisma.creditAction.update({
      where: {
        id: creditAction.id,
      },
      data: {
        status: "Failed",
        errorNote:
          "Failed to create job: " +
          (error instanceof Error ? error.message : "Unknown error"),
      },
    });
    throw new Error("Failed to create job", { cause: error });
  }
}

const calculatedInputHash = (inputData: { key: string; value: string }[]) => {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(inputData))
    .digest("hex");
};
