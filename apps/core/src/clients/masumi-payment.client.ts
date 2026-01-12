import type { InputSchemaType } from "@sokosumi/masumi/schemas";
import { err, ok } from "neverthrow";

import { getEnv } from "@/config/env";

import {
  getPurchase,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
} from "./openapi/generated/payment";
import { createClient } from "./openapi/generated/payment/client";

export const paymentClient = (() => {
  const client = () => {
    const paymentClient = createClient({
      baseUrl: getEnv().PAYMENT_API_URL,
    });
    paymentClient.setConfig({
      headers: { token: getEnv().PAYMENT_API_KEY },
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
            network: getEnv().NETWORK,
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
            network: getEnv().NETWORK,
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
            network: getEnv().NETWORK,
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
      jobId: string,
      agentBlockchainIdentifier: string,
      inputHash: string,
      blockchainIdentifier: string,
      sellerVkey: string,
      payByTime: Date,
      externalDisputeUnlockTime: Date,
      submitResultTime: Date,
      unlockTime: Date,
      inputData: InputSchemaType,
      identifierFromPurchaser: string,
    ) {
      try {
        const response = await postPurchase({
          client: client(),
          body: {
            agentIdentifier: agentBlockchainIdentifier,
            inputHash: inputHash,
            blockchainIdentifier: blockchainIdentifier,
            network: getEnv().NETWORK,
            sellerVkey: sellerVkey,
            identifierFromPurchaser,
            payByTime: payByTime.toString(),
            externalDisputeUnlockTime: externalDisputeUnlockTime.toString(),
            submitResultTime: submitResultTime.toString(),
            unlockTime: unlockTime.toString(),
            metadata: JSON.stringify({
              inputData: inputData,
              jobId: jobId,
            }),
          },
        });

        if (response.error || !response.data) {
          console.error("Failed to create purchase request", response.error);
          return err("Failed to create purchase request");
        }

        return ok(response.data.data);
      } catch (error) {
        return err(error);
      }
    },
  };
})();
