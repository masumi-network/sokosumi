import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { err, ok, type Result } from "neverthrow";

import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  getRailReadiness,
  type PostPurchaseData,
  type PostPurchaseResolveBlockchainIdentifierResponses,
  type PostPurchaseResponses,
  postPurchase,
  postPurchaseRequestRefund,
  postPurchaseResolveBlockchainIdentifier,
} from "./openapi/generated/payment/index.js";

interface PaymentClientRequestOptions {
  signal?: AbortSignal;
}

const CARDANO_POLICY_ID_PATTERN = /^[0-9a-f]{56}$/;

function extractNodeErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    typeof error.error === "object" &&
    error.error !== null &&
    "message" in error.error &&
    typeof error.error.message === "string"
  ) {
    return error.error.message;
  }
  return JSON.stringify(error) ?? String(error);
}

export interface CardanoV2ReadySource {
  policyId: string;
  smartContractAddress: string;
}

type ResolvedPurchase =
  PostPurchaseResolveBlockchainIdentifierResponses["200"]["data"];
type CreatedPurchase = PostPurchaseResponses["200"]["data"];
type PurchaseRequest = NonNullable<PostPurchaseData["body"]>;

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
    request: PurchaseRequest,
  ): Promise<Result<CreatedPurchase, string>> => {
    // The node's duplicate check is NOT wallet-scope filtered, so the 409's
    // embedded purchase may belong to another API key's scope. Only accept a
    // matching purchase returned by the scope-filtered resolve endpoint. On a
    // transient resolve failure, Core's job-sync backfill retries this lookup
    // safely.
    try {
      const response = await postPurchaseResolveBlockchainIdentifier({
        client: client(),
        body: {
          blockchainIdentifier: request.blockchainIdentifier,
          network,
        },
      });
      if (response.data && !response.error) {
        const purchase = response.data.data;
        const matchesRequest =
          purchase.blockchainIdentifier === request.blockchainIdentifier &&
          purchase.agentIdentifier === request.agentIdentifier &&
          purchase.inputHash === request.inputHash &&
          purchase.payByTime === request.payByTime &&
          purchase.submitResultTime === request.submitResultTime &&
          purchase.unlockTime === request.unlockTime &&
          purchase.externalDisputeUnlockTime ===
            request.externalDisputeUnlockTime &&
          purchase.metadata === (request.metadata ?? null) &&
          (request.paymentSourceType === undefined ||
            purchase.PaymentSource.paymentSourceType ===
              request.paymentSourceType) &&
          (request.smartContractAddress === undefined ||
            purchase.PaymentSource.smartContractAddress ===
              request.smartContractAddress);
        if (!matchesRequest) {
          return err("Duplicate purchase does not match request");
        }
        return ok(purchase);
      }
      if (response.response?.status === 404) {
        return err("Duplicate purchase is not visible to this API key");
      }
    } catch {
      return err("Failed to resolve duplicate purchase");
    }

    return err("Failed to resolve duplicate purchase");
  };

  return {
    async getPurchaseByBlockchainIdentifier(
      jobBlockchainIdentifier: string,
      options: PaymentClientRequestOptions = {},
    ) {
      return resolvePurchase(jobBlockchainIdentifier, options);
    },

    /**
     * Exact Cardano V2 policy/contract sources the payment node can purchase
     * through right now.
     */
    async getCardanoV2RailReadiness(
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<CardanoV2ReadySource[], string>> {
      try {
        const response = await getRailReadiness({
          client: client(),
          query: { network },
          signal: options.signal,
        });
        if (response.error || !response.data) {
          return err(
            `rail-readiness ${response.response?.status ?? "unknown"}: ${extractNodeErrorMessage(response.error)}`,
          );
        }
        const cardanoV2Rail = response.data.data.Rails.find(
          (rail) => rail.rail === "CardanoV2",
        );
        if (!cardanoV2Rail?.PurchaseSources) {
          return err(
            "rail-readiness response does not include per-source purchase readiness",
          );
        }
        const readySources = new Map<string, CardanoV2ReadySource>();
        for (const source of cardanoV2Rail.PurchaseSources) {
          if (
            source.isPurchaseReady &&
            source.policyId &&
            CARDANO_POLICY_ID_PATTERN.test(source.policyId)
          ) {
            const readySource = {
              policyId: source.policyId,
              smartContractAddress: source.smartContractAddress,
            };
            readySources.set(
              `${readySource.policyId}:${readySource.smartContractAddress}`,
              readySource,
            );
          }
        }
        return ok(Array.from(readySources.values()));
      } catch (error) {
        return err(String(error) || "Failed to get rail readiness");
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
      amounts?: Array<{ amount: string; unit: string }>,
    ): Promise<Result<PostPurchaseResponses["200"]["data"], string>> {
      try {
        const body: PurchaseRequest = {
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
          // Price-drift guard: when supplied, the node rejects the purchase
          // unless these exactly match the agent's current on-chain pricing,
          // so the escrow can never lock a different amount than the credits
          // the user was charged.
          ...(amounts ? { Amounts: amounts } : {}),
          metadata: JSON.stringify({
            inputData,
            jobId: startJobResponse.id,
          }),
        };
        const response = await postPurchase({
          client: client(),
          body,
        });

        if (response.error || !response.data) {
          if (response.response?.status === 409) {
            console.info(
              "[masumi-payment] createPurchase: purchase already exists",
              { blockchainIdentifier: startJobResponse.blockchainIdentifier },
            );
            return recoverDuplicatePurchase(body);
          }
          console.error("Failed to create purchase request", response.error);
          return err(
            `Failed to create purchase request (status ${response.response?.status ?? "unknown"}): ${extractNodeErrorMessage(response.error)}`,
          );
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
        const body: PurchaseRequest = {
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
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        };
        const response = await postPurchase({
          client: client(),
          body,
        });

        if (response.error || !response.data) {
          if (response.response?.status === 409) {
            console.info(`${logLabel} purchase already exists`, {
              network,
              blockchainIdentifier: input.blockchainIdentifier,
            });
            return recoverDuplicatePurchase(body);
          }
          console.error(`${logLabel} payment API error`, {
            network,
            blockchainIdentifier: input.blockchainIdentifier,
            error: response.error,
          });
          // The event is already charged when this error surfaces — carry the
          // node's status and reason so the alert is actionable.
          return err(
            `Failed to create purchase request (status ${response.response?.status ?? "unknown"}): ${extractNodeErrorMessage(response.error)}`,
          );
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
