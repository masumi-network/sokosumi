import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { err, ok, type Result } from "neverthrow";

import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  getPurchase,
  type PostPurchaseResponses,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
} from "./openapi/generated/payment/index.js";

interface PaymentClientRequestOptions {
  signal?: AbortSignal;
}

interface MasumiTaskPurchaseInput {
  blockchainIdentifier: string;
  agentIdentifier: string;
  sellerVkey: string;
  submitResultTime: string;
  payByTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
  inputHash: string;
  Amounts: Array<{ amount: string; unit: string }>;
  identifierFromPurchaser: string;
  metadata?: string;
}

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
    async getPurchaseByBlockchainIdentifier(
      jobBlockchainIdentifier: string,
      options: PaymentClientRequestOptions = {},
    ) {
      try {
        const response = await postPurchaseResolveBlockchainIdentifier({
          client: client(),
          body: {
            blockchainIdentifier: jobBlockchainIdentifier,
            network,
          },
          signal: options.signal,
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

    async getPurchaseById(
      purchaseId: string,
      options: PaymentClientRequestOptions = {},
    ) {
      try {
        const response = await getPurchase({
          client: client(),
          query: {
            cursorId: purchaseId,
            network,
            limit: 1,
          },
          signal: options.signal,
        });

        if (
          response.error ||
          !response.data ||
          response.data.data.Purchases.length !== 1
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

    async createPurchaseFromMasumiTaskPayment(
      input: MasumiTaskPurchaseInput,
    ): Promise<Result<PostPurchaseResponses["200"]["data"], string>> {
      const logLabel = "[masumi-payment] createPurchaseFromMasumiTaskPayment";
      console.info(`${logLabel} request`, {
        network,
        blockchainIdentifier: input.blockchainIdentifier,
        agentIdentifier: input.agentIdentifier,
        identifierFromPurchaser: input.identifierFromPurchaser,
        amountsCount: input.Amounts.length,
        hasMetadata: input.metadata !== undefined,
      });

      try {
        const response = await postPurchase({
          client: client(),
          body: {
            blockchainIdentifier: input.blockchainIdentifier,
            agentIdentifier: input.agentIdentifier,
            sellerVkey: input.sellerVkey,
            submitResultTime: input.submitResultTime,
            payByTime: input.payByTime,
            unlockTime: input.unlockTime,
            externalDisputeUnlockTime: input.externalDisputeUnlockTime,
            inputHash: input.inputHash,
            Amounts: input.Amounts,
            identifierFromPurchaser: input.identifierFromPurchaser,
            network,
            ...(input.metadata !== undefined
              ? { metadata: input.metadata }
              : {}),
          },
        });

        if (response.error || !response.data) {
          console.error(`${logLabel} payment API error`, {
            network,
            blockchainIdentifier: input.blockchainIdentifier,
            error: response.error,
          });
          return err("Failed to create purchase request");
        }

        const data = response.data.data;
        console.info(`${logLabel} success`, {
          network,
          purchaseId: data.id,
          blockchainIdentifier: data.blockchainIdentifier,
        });

        return ok(data);
      } catch (error) {
        console.error(`${logLabel} unexpected error`, {
          network,
          blockchainIdentifier: input.blockchainIdentifier,
          error,
        });
        return err(String(error) || "Failed to create purchase request");
      }
    },
  };
}
