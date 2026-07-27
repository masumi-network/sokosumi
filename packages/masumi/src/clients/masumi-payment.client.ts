import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { err, ok, type Result } from "neverthrow";

import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  type PostPurchaseErrors,
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
type CreatedPurchase = PostPurchaseResponses["200"]["data"];
type DuplicatePurchase = PostPurchaseErrors["409"]["object"];

function getDuplicatePurchase(
  error: unknown,
  blockchainIdentifier: string,
): DuplicatePurchase | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("object" in error) ||
    typeof error.object !== "object" ||
    error.object === null ||
    !("id" in error.object) ||
    typeof error.object.id !== "string" ||
    !("blockchainIdentifier" in error.object) ||
    error.object.blockchainIdentifier !== blockchainIdentifier
  ) {
    return undefined;
  }

  return error.object as DuplicatePurchase;
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
  paymentSourceType?: "Web3CardanoV1" | "Web3CardanoV2";
  smartContractAddress?: string;
  supportedPaymentSourceIndex?: number;
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

  const recoverDuplicatePurchase = async (
    error: unknown,
    blockchainIdentifier: string,
  ): Promise<Result<CreatedPurchase, string>> => {
    const duplicatePurchase = getDuplicatePurchase(error, blockchainIdentifier);
    if (duplicatePurchase) {
      return ok(duplicatePurchase);
    }

    return resolvePurchase(blockchainIdentifier);
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
            paymentSourceType: startJobResponse.paymentSourceType,
            supportedPaymentSourceIndex:
              startJobResponse.supportedPaymentSourceIndex,
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
            console.info(
              "[masumi-payment] createPurchase: purchase already exists",
              { blockchainIdentifier: startJobResponse.blockchainIdentifier },
            );
            return recoverDuplicatePurchase(
              response.error,
              startJobResponse.blockchainIdentifier,
            );
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
            paymentSourceType: input.paymentSourceType,
            smartContractAddress: input.smartContractAddress,
            supportedPaymentSourceIndex: input.supportedPaymentSourceIndex,
            ...(input.metadata !== undefined
              ? { metadata: input.metadata }
              : {}),
          },
        });

        if (response.error || !response.data) {
          if (response.response?.status === 409) {
            console.info(`${logLabel} purchase already exists`, {
              network,
              blockchainIdentifier: input.blockchainIdentifier,
            });
            return recoverDuplicatePurchase(
              response.error,
              input.blockchainIdentifier,
            );
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
