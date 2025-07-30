import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import {
  getPurchase,
  postPurchase,
  postPurchaseRequestRefund,
  PostPurchaseResponse,
} from "@/lib/api/generated/payment";
import { getPaymentClient } from "@/lib/api/payment-service.client";
import { AgentWithRelations } from "@/lib/db";
import { JobInputData } from "@/lib/job-input";
import { StartJobResponseSchemaType } from "@/lib/schemas";
import { Err, Ok, Result } from "@/lib/ts-res";

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
  purchaseId: string,
): Promise<Result<Purchase, string>> {
  try {
    const paymentClient = getPaymentClient();
    const purchaseResponse = await getPurchase({
      client: paymentClient,
      query: {
        cursorId: purchaseId,
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
        sellerVkey: startJobResponse.sellerVKey,
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
      console.log(
        "Failed to create purchase request",
        postPurchaseResponse.error,
      );
      return Err("Failed to create purchase request");
    }

    return Ok(postPurchaseResponse.data);
  } catch (err) {
    return Err(String(err));
  }
}
