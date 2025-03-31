import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { z } from "zod";

import { getEnvSecrets } from "@/config/env.config";
import { getPurchase, postPurchase } from "@/lib/api/generated/payment";
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

const jobInclude = {
  agent: true,
  user: true,
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

/**
 * Retrieves all jobs associated with a specific agent and user
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function getUserJobsByAgentId(
  agentId: string,
  userId: string,
): Promise<JobWithRelations[]> {
  const jobs = await prisma.job.findMany({
    where: {
      agentId,
      userId,
    },
    include: jobInclude,
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!jobs) {
    return [];
  }

  return jobs;
}

export async function syncJobStatus(jobId: string) {
  const job = await prisma.job.findUnique({
    where: {
      id: jobId,
    },
  });

  if (!job) {
    throw new Error("Job not found");
  }

  const agent = await getAgentById(job.agentId);

  if (!agent) {
    throw new Error("Agent not found");
  }

  const purchase = await getPurchase({
    query: {
      cursorId: job.paymentId,
      network: "Preprod",
      limit: 1,
    },
  });

  if (
    purchase.error ||
    !purchase.data ||
    purchase.data.data.Purchases.length != 1
  ) {
    throw new Error("Failed to get on-chain status");
  }

  const onChainState = purchase.data.data.Purchases[0].onChainState;

  if (onChainState === "FundsLocked") {
    return;
  }

  if (onChainState === "ResultSubmitted" || onChainState == "Withdrawn") {
    const baseUrl = agent.apiBaseUrl;
    const syncJobUrl = new URL(`${baseUrl}/status?job_id=${job.agentJobId}`);
    const syncJobResponse = await fetch(syncJobUrl, {
      method: "GET",
    });
    if (!syncJobResponse.ok) {
      await prisma.job.update({
        where: {
          id: jobId,
        },
        data: {
          status: "FAILED",
          errorNote:
            "Failed to get on-chain status: " + syncJobResponse.statusText,
        },
      });
      throw new Error("Failed to get on-chain status");
    }

    const syncJobResponseData = await syncJobResponse.json();
    if (syncJobResponseData.error) {
      await prisma.job.update({
        where: {
          id: jobId,
        },
        data: {
          status: "FAILED",
          errorNote: "Failed to get output: " + syncJobResponseData.error,
        },
      });
      throw new Error("Failed to get output");
    }

    const output = JSON.stringify(syncJobResponseData);

    await prisma.job.update({
      where: {
        id: jobId,
      },
      data: {
        status: "COMPLETED",
        output: output,
        finishedAt: new Date(),
      },
    });
    return;
  }
  await prisma.job.update({
    where: {
      id: jobId,
    },
    data: {
      status: "FAILED",
      errorNote: "Unknown on-chain state: " + onChainState,
    },
  });
}
