import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { err, ok, Result } from "neverthrow";

import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  getPurchase,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
  type PostPurchaseResponses,
} from "./openapi/generated/payment/index.js";

export function createPaymentClient(
  network: "Preprod" | "Mainnet",
  apiUrl: string,
  apiKey: string,
) {
  const client = () => {
    const paymentClient = createClient({
      baseUrl: apiUrl,
    });
    paymentClient.setConfig({
      headers: { token: apiKey },
    });
    return paymentClient;
  };

  return {
    async getPurchaseByBlockchainIdentifier(jobBlockchainIdentifier: string) {
      try {
        const response = await postPurchaseResolveBlockchainIdentifier({
          client: client(),
          body: {
            blockchainIdentifier: jobBlockchainIdentifier,
            network,
          },
        });
        if (response.error || !response.data) {
          return err(
            response.error ? String(response.error) : "Failed to get purchase",
          );
        }
        return ok(response.data.data);
      } catch (error) {
        return err(error);
      }
    },

    async getPurchaseById(purchaseId: string) {
      try {
        const response = await getPurchase({
          client: client(),
          query: {
            cursorId: purchaseId,
            network,
            limit: 1,
          },
        });

        if (
          response.error ||
          !response.data ||
          response.data.data.Purchases.length != 1
        ) {
          return err(response.error ? String(response.error) : "Unknown error");
        }
        const purchase = response.data.data.Purchases[0];

        return ok(purchase);
      } catch (error) {
        return err(error);
      }
    },

    async requestRefund(jobBlockchainIdentifier: string) {
      try {
        const response = await postPurchaseRequestRefund({
          client: client(),
          body: {
            blockchainIdentifier: jobBlockchainIdentifier,
            network,
          },
        });

        if (response.error || !response.data) {
          return err("Failed to request refund");
        }

        return ok();
      } catch (error) {
        return err(error);
      }
    },

    async createPurchase(
      agentBlockchainIdentifier: string,
      startJobResponse: StartPaidJobResponseSchemaType,
      inputData: InputSchemaType,
      identifierFromPurchaser: string,
    ): Promise<Result<PostPurchaseResponses["200"]["data"], string>> {
      try {
        const response = await postPurchase({
          client: client(),
          body: {
            agentIdentifier: agentBlockchainIdentifier,
            inputHash: startJobResponse.input_hash,
            blockchainIdentifier: startJobResponse.blockchainIdentifier,
            network,
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
          return err("Failed to create purchase request");
        }

        return ok(response.data.data);
      } catch (error) {
        return err(String(error) || "Failed to create purchase request");
      }
    },
  };
}

// export const paymentClient = createPaymentClient(
//   getEnv().NETWORK,
//   getEnv().PAYMENT_API_URL,
//   getEnv().PAYMENT_API_KEY,
// );
