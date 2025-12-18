import "server-only";

import { InputSchemaType } from "@sokosumi/masumi/schemas";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import type { GetPurchaseResponses } from "@/lib/clients/generated/payment";
import {
  getPurchase,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
} from "@/lib/clients/generated/payment";
import { createClient } from "@/lib/clients/generated/payment/client";
import { StartJobResponseSchemaType } from "@/lib/schemas";
import { Err, Ok, Result } from "@/lib/ts-res";

// Export Purchase type and nested types for reuse in transformers
export type Purchase = GetPurchaseResponses[200]["data"]["Purchases"][0];
export type PurchaseOnChainState = Purchase["onChainState"];
export type PurchaseNextAction = Purchase["NextAction"];
export type PurchaseCurrentTransaction = Purchase["CurrentTransaction"];
export type PurchaseRequestedAction = PurchaseNextAction["requestedAction"];
export type PurchaseErrorType = PurchaseNextAction["errorType"];

export const paymentClient = (() => {
  const client = () => {
    const paymentClient = createClient({
      baseUrl: getEnvSecrets().PAYMENT_API_URL,
    });
    paymentClient.setConfig({
      headers: { token: getEnvSecrets().PAYMENT_API_KEY },
    });
    return paymentClient;
  };

  return {
    async getPurchaseByBlockchainIdentifier(
      jobBlockchainIdentifier: string,
    ): Promise<Result<Purchase, string>> {
      try {
        const response = await postPurchaseResolveBlockchainIdentifier({
          client: client(),
          body: {
            blockchainIdentifier: jobBlockchainIdentifier,
            network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
          },
        });
        if (response.error || !response.data) {
          return Err(
            response.error ? String(response.error) : "Failed to get purchase",
          );
        }
        return Ok(response.data.data);
      } catch (err) {
        return Err(String(err));
      }
    },

    async getPurchaseById(
      purchaseId: string,
    ): Promise<Result<Purchase, string>> {
      try {
        const response = await getPurchase({
          client: client(),
          query: {
            cursorId: purchaseId,
            network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
            limit: 1,
          },
        });

        if (
          response.error ||
          !response.data ||
          response.data.data.Purchases.length != 1
        ) {
          return Err(response.error ? String(response.error) : "Unknown error");
        }
        const purchase = response.data.data.Purchases[0];

        return Ok(purchase);
      } catch (err) {
        return Err(String(err));
      }
    },

    async requestRefund(
      jobBlockchainIdentifier: string,
    ): Promise<Result<void, string>> {
      try {
        const response = await postPurchaseRequestRefund({
          client: client(),
          body: {
            blockchainIdentifier: jobBlockchainIdentifier,
            network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
          },
        });

        if (response.error || !response.data) {
          return Err("Failed to request refund");
        }

        return Ok();
      } catch (err) {
        return Err(String(err));
      }
    },

    async createPurchase(
      agentBlockchainIdentifier: string,
      startJobResponse: StartJobResponseSchemaType,
      inputData: InputSchemaType,
      identifierFromPurchaser: string,
    ): Promise<Result<Purchase, string>> {
      try {
        const response = await postPurchase({
          client: client(),
          body: {
            agentIdentifier: agentBlockchainIdentifier,
            inputHash: startJobResponse.input_hash,
            blockchainIdentifier: startJobResponse.blockchainIdentifier,
            network: getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
            sellerVkey: startJobResponse.sellerVKey,
            identifierFromPurchaser,
            payByTime: startJobResponse.payByTime.toString(),
            externalDisputeUnlockTime:
              startJobResponse.externalDisputeUnlockTime.toString(),
            submitResultTime: startJobResponse.submitResultTime.toString(),
            unlockTime: startJobResponse.unlockTime.toString(),
            metadata: JSON.stringify({
              inputData: inputData,
              jobId: startJobResponse.id,
            }),
          },
        });

        if (response.error || !response.data) {
          console.error("Failed to create purchase request", response.error);
          return Err("Failed to create purchase request");
        }

        return Ok(response.data.data as Purchase);
      } catch (err) {
        return Err(String(err));
      }
    },
  };
})();
