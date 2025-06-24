"use server";

import { Err, Ok, Result } from "ts-res";

import { getEnvPublicConfig } from "@/config/env.config";
import {
  getPurchase,
  postPurchase,
  postPurchaseRequestRefund,
  PostPurchaseResponse,
} from "@/lib/api/generated/payment";
import { getPaymentClient } from "@/lib/api/payment-service.client";
import { AgentWithRelations, getAgentApiBaseUrl } from "@/lib/db";
import { JobInputData } from "@/lib/job-input";

import {
  jobStatusResponseSchema,
  JobStatusResponseSchemaType,
  startJobResponseSchema,
  StartJobResponseSchemaType,
} from "./schemas";

export async function fetchAgentJobStatus(
  agent: AgentWithRelations,
  jobId: string,
): Promise<Result<JobStatusResponseSchemaType, string>> {
  try {
    const baseUrl = getAgentApiBaseUrl(agent);
    const jobStatusUrl = new URL(`/status`, baseUrl);
    jobStatusUrl.searchParams.set("job_id", jobId);
    const jobStatusResponse = await fetch(jobStatusUrl, {
      method: "GET",
    });

    if (!jobStatusResponse.ok) {
      return Err(jobStatusResponse.statusText);
    }
    const parsedResult = jobStatusResponseSchema.safeParse(
      await jobStatusResponse.json(),
    );
    if (!parsedResult.success) {
      return Err("Failed to parse job status response");
    }

    return Ok(parsedResult.data);
  } catch (err) {
    return Err(String(err));
  }
}

export async function startAgentJob(
  agent: AgentWithRelations,
  identifierFromPurchaser: string,
  inputData: JobInputData,
): Promise<Result<StartJobResponseSchemaType, string>> {
  try {
    const baseUrl = getAgentApiBaseUrl(agent);
    const startJobUrl = new URL(`/start_job`, baseUrl);

    const startJobResponse = await fetch(startJobUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier_from_purchaser: identifierFromPurchaser,
        input_data: Object.fromEntries(inputData),
      }),
    });

    if (!startJobResponse.ok) {
      return Err("Failed to start job");
    }

    const parsedResult = startJobResponseSchema.safeParse(
      await startJobResponse.json(),
    );
    if (!parsedResult.success) {
      return Err("Failed to parse start job response");
    }

    return Ok(parsedResult.data);
  } catch (err) {
    return Err(String(err));
  }
}

export async function postPaymentClientRequestRefund(
  jobBlockchainIdentifier: string,
): Promise<Result<void, string>> {
  try {
    const paymentClient = getPaymentClient();
    const refundResponse = await postPurchaseRequestRefund({
      client: paymentClient,
      body: {
        blockchainIdentifier: jobBlockchainIdentifier,
        network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
      },
    });

    if (refundResponse.error || !refundResponse.data) {
      return Err("Failed to request refund");
    }

    return Ok();
  } catch (err) {
    return Err(String(err));
  }
}

export async function getPaymentClientPurchase(
  paymentId: string,
): Promise<Result<Purchase, string>> {
  try {
    const paymentClient = getPaymentClient();
    const purchaseResponse = await getPurchase({
      client: paymentClient,
      query: {
        cursorId: paymentId,
        network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        limit: 1,
      },
    });

    if (
      purchaseResponse.error ||
      !purchaseResponse.data ||
      purchaseResponse.data.data.Purchases.length != 1
    ) {
      return Err(
        purchaseResponse.error
          ? String(purchaseResponse.error)
          : "Unknown error",
      );
    }
    const purchase = purchaseResponse.data.data.Purchases[0];

    return Ok(purchase);
  } catch (err) {
    return Err(String(err));
  }
}

export async function createPurchase(
  agent: AgentWithRelations,
  startJobResponse: StartJobResponseSchemaType,
  inputData: JobInputData,
  inputHash: string,
  identifierFromPurchaser: string,
): Promise<Result<PostPurchaseResponse, string>> {
  try {
    const paymentClient = getPaymentClient();

    const postPurchaseResponse = await postPurchase({
      client: paymentClient,
      body: {
        agentIdentifier: agent.blockchainIdentifier,
        inputHash: inputHash,
        blockchainIdentifier: startJobResponse.blockchainIdentifier,
        network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
        sellerVkey: startJobResponse.sellerVkey,
        paymentType: "Web3CardanoV1",
        identifierFromPurchaser,
        payByTime: startJobResponse.payByTime.toString(),
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

    if (postPurchaseResponse.error || !postPurchaseResponse.data) {
      return Err("Failed to create purchase request");
    }

    return Ok(postPurchaseResponse.data);
  } catch (err) {
    return Err(String(err));
  }
}
