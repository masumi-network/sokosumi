import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { err, ok, type Result } from "neverthrow";

import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  type PostPurchaseResolveBlockchainIdentifierResponses,
  type PostPurchaseResponses,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
} from "./openapi/generated/payment/index.js";

interface PaymentClientRequestOptions {
  signal?: AbortSignal;
}

type ResolvedPurchase =
  PostPurchaseResolveBlockchainIdentifierResponses["200"]["data"];

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

  const resolvePurchase = async (
    blockchainIdentifier: string,
    options: PaymentClientRequestOptions = {},
  ): Promise<Result<ResolvedPurchase, string>> => {
    try {
      const response = await postPurchaseResolveBlockchainIdentifier({
        client: client(),
        body: {
          blockchainIdentifier,
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
      return err(String(error) || "Failed to get purchase");
    }
  };

  return {
    async getPurchaseByBlockchainIdentifier(
      jobBlockchainIdentifier: string,
      options: PaymentClientRequestOptions = {},
    ) {
      return resolvePurchase(jobBlockchainIdentifier, options);
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
          if (response.response?.status === 409) {
            // Duplicate blockchainIdentifier: the purchase already exists on
            // the payment node (e.g. a retried request). Resolve it and treat
            // the call as idempotent success.
            console.info(
              "[masumi-payment] createPurchase: purchase already exists, resolving",
              { blockchainIdentifier: startJobResponse.blockchainIdentifier },
            );
            return resolvePurchase(startJobResponse.blockchainIdentifier);
          }
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
          if (response.response?.status === 409) {
            // Duplicate blockchainIdentifier: idempotent retry — resolve the
            // existing purchase instead of reporting an error.
            console.info(`${logLabel} purchase already exists, resolving`, {
              network,
              blockchainIdentifier: input.blockchainIdentifier,
            });
            return resolvePurchase(input.blockchainIdentifier);
          }
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
