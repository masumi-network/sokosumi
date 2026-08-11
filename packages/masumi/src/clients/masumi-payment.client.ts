import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { err, ok, type Result } from "neverthrow";

import { doHexValuesMatch } from "../utils/hex.js";
import {
  doMasumiPaymentAmountsMatch,
  toMasumiPaymentNodeAmounts,
} from "../utils/payment-amounts.js";
import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  type GetX402BudgetsResponses,
  type GetX402NetworksAvailableResponses,
  getApiKeyStatus,
  getRailReadiness,
  getX402Budgets as getX402BudgetsRequest,
  getX402NetworksAvailable,
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
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export interface CardanoV2ReadySource {
  policyId: string;
  smartContractAddress: string;
}

/** One x402 EVM chain the node reports accessible (`GET /x402/networks/available`). */
export type X402AvailableNetwork =
  GetX402NetworksAvailableResponses["200"]["data"]["Networks"][number];

/** One x402 wallet budget granted to an API key (`GET /x402/budgets`). */
export type X402Budget =
  GetX402BudgetsResponses["200"]["data"]["Budgets"][number];

type ResolvedPurchase =
  PostPurchaseResolveBlockchainIdentifierResponses["200"]["data"];
type CreatedPurchase = PostPurchaseResponses["200"]["data"];
type PurchaseRequest = NonNullable<PostPurchaseData["body"]>;

interface ResolvedPurchaseSellerIdentity {
  SellerWallet: { walletVkey: string } | null | undefined;
}

/**
 * Matches the seller wallet supplied in the purchase request. Payment node
 * stores that identity in SellerWallet for both V1 and V2 purchases.
 */
export function doesResolvedPurchaseSellerMatch(
  purchase: ResolvedPurchaseSellerIdentity,
  expectedSellerVkey: string,
): boolean {
  const wallet = purchase.SellerWallet;
  return (
    wallet !== null &&
    wallet !== undefined &&
    wallet.walletVkey.toLowerCase() === expectedSellerVkey.toLowerCase()
  );
}

export interface MasumiTaskPurchaseInput {
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

/**
 * A failed purchase creation. `kind` — not the message text — is what callers
 * branch on: a "permanent" rejection is the node refusing this exact payload
 * (price drift, invalid terms) and will fail identically on every retry, while
 * "ambiguous" means the outcome is unknown and a purchase may already exist.
 */
export interface PurchaseFailure {
  kind: "permanent" | "ambiguous";
  message: string;
  status?: number;
}

/**
 * Statuses that mean "our infrastructure or credentials are wrong", not "the
 * node rejected this payload". They must stay retryable: on the task-payment
 * rail a `permanent` verdict is terminal — it refunds the claim, takes it out
 * of PENDING (so cron and all three admin levers skip it), and the
 * `@@unique([network, blockchainIdentifier])` index blocks resubmission. A
 * rotated PAYMENT_API_KEY answering 401 would otherwise convert every in-flight
 * task payment into a refund with the seller's work already delivered.
 */
const RETRYABLE_INFRASTRUCTURE_STATUSES = new Set([401, 403, 404, 408, 429]);

function classifyPurchaseFailureKind(
  status: number | undefined,
): PurchaseFailure["kind"] {
  return status !== undefined &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_INFRASTRUCTURE_STATUSES.has(status)
    ? "permanent"
    : "ambiguous";
}

interface TaskPurchaseResolutionFailure {
  kind: "not_found" | "mismatch" | "ambiguous";
  message: string;
  status?: number;
}

function doPurchaseAmountsMatchRequest(
  purchase: ResolvedPurchase,
  request: PurchaseRequest,
): boolean {
  if (request.Amounts === undefined) {
    return true;
  }
  return doMasumiPaymentAmountsMatch(request.Amounts, purchase.PaidFunds);
}

/**
 * Compares two protocol millisecond timestamps by VALUE, not by spelling.
 *
 * These cross a numeric boundary: we send a string, the node stores a number,
 * and it serializes the canonical form back. So "0177…" and "177…" are the
 * same instant but not the same string. Comparing raw would report `mismatch`
 * — and `mismatch` refunds the buyer while the on-chain purchase stays live.
 *
 * An absent value never matches: without it the terms cannot be verified, and
 * adopting an unverifiable purchase is worse than refusing it.
 */
function doTimestampsMatch(
  left: string | null | undefined,
  right: string,
): boolean {
  if (left == null) {
    return false;
  }
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function doesPurchaseMatchRequest(
  purchase: ResolvedPurchase,
  request: PurchaseRequest,
): boolean {
  return (
    doHexValuesMatch(
      purchase.blockchainIdentifier,
      request.blockchainIdentifier,
    ) &&
    doHexValuesMatch(purchase.agentIdentifier, request.agentIdentifier) &&
    doHexValuesMatch(purchase.inputHash, request.inputHash) &&
    doTimestampsMatch(purchase.payByTime, request.payByTime) &&
    doTimestampsMatch(purchase.submitResultTime, request.submitResultTime) &&
    doTimestampsMatch(purchase.unlockTime, request.unlockTime) &&
    doTimestampsMatch(
      purchase.externalDisputeUnlockTime,
      request.externalDisputeUnlockTime,
    ) &&
    purchase.metadata === (request.metadata ?? null) &&
    doesResolvedPurchaseSellerMatch(purchase, request.sellerVkey) &&
    (request.paymentSourceType === undefined ||
      purchase.PaymentSource.paymentSourceType === request.paymentSourceType) &&
    (request.smartContractAddress === undefined ||
      purchase.PaymentSource.smartContractAddress.toLowerCase() ===
        request.smartContractAddress.toLowerCase()) &&
    doPurchaseAmountsMatchRequest(purchase, request)
  );
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
    options: PaymentClientRequestOptions = {},
  ): Promise<Result<CreatedPurchase, PurchaseFailure>> => {
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
        signal: options.signal,
      });
      if (response.data && !response.error) {
        const purchase = response.data.data;
        if (!doesPurchaseMatchRequest(purchase, request)) {
          return err({
            kind: "permanent",
            message: "Duplicate purchase does not match request",
          });
        }
        return ok(purchase);
      }
      if (response.response?.status === 404) {
        return err({
          kind: "permanent",
          message: "Duplicate purchase is not visible to this API key",
          status: 404,
        });
      }
    } catch {
      return err({
        kind: "ambiguous",
        message: "Failed to resolve duplicate purchase",
      });
    }

    return err({
      kind: "ambiguous",
      message: "Failed to resolve duplicate purchase",
    });
  };

  const buildTaskPurchaseRequest = (
    input: MasumiTaskPurchaseInput,
  ): PurchaseRequest => ({
    blockchainIdentifier: input.blockchainIdentifier,
    agentIdentifier: input.agentIdentifier,
    sellerVkey: input.sellerVkey,
    submitResultTime: input.submitResultTime,
    payByTime: input.payByTime,
    unlockTime: input.unlockTime,
    externalDisputeUnlockTime: input.externalDisputeUnlockTime,
    inputHash: input.inputHash,
    // Spell ADA the way POST /purchase documents it — an empty unit — exactly
    // as the hire path does before calling createPurchase. A task payment is
    // charged in credits from these same Amounts, and
    // calculateCentsFromMasumiAmountStrings normalizes "" and "lovelace" to
    // one scale, so a caller spelling ADA as "lovelace" is billed correctly
    // and would then be sent to the node as a non-hex asset that names
    // nothing. That purchase can never succeed: the outbox would burn its
    // whole retry ladder and escalate to human review before refunding a
    // debit that was correct all along.
    //
    // Applied here rather than where the claim is written so replays of
    // already-stored claims are converted too, and so all three callers —
    // create, the 409 resolve, and resolve-only — go through one seam.
    // doesPurchaseMatchRequest stays correct because
    // doMasumiPaymentAmountsMatch normalizes both sides before comparing.
    Amounts: toMasumiPaymentNodeAmounts(input.Amounts),
    identifierFromPurchaser: input.identifierFromPurchaser,
    network,
    paymentSourceType: input.paymentSourceType,
    smartContractAddress: input.smartContractAddress,
    supportedPaymentSourceIndex: input.supportedPaymentSourceIndex,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });

  const resolveTaskPurchase = async (
    request: PurchaseRequest,
    options: PaymentClientRequestOptions = {},
  ): Promise<Result<CreatedPurchase, TaskPurchaseResolutionFailure>> => {
    try {
      const response = await postPurchaseResolveBlockchainIdentifier({
        client: client(),
        body: {
          blockchainIdentifier: request.blockchainIdentifier,
          network,
        },
        signal: options.signal,
      });
      if (response.data && !response.error) {
        const purchase = response.data.data;
        if (!doesPurchaseMatchRequest(purchase, request)) {
          return err({
            kind: "mismatch",
            message: "Resolved purchase does not match durable task payment",
          });
        }
        return ok(purchase);
      }
      const status = response.response?.status;
      if (status === 404) {
        return err({
          kind: "not_found",
          message: "Task purchase not found",
          status,
        });
      }
      return err({
        kind: "ambiguous",
        message: `Failed to resolve task purchase (status ${status ?? "unknown"}): ${extractNodeErrorMessage(response.error)}`,
        status,
      });
    } catch (error) {
      return err({
        kind: "ambiguous",
        message: String(error) || "Failed to resolve task purchase",
      });
    }
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
          // Normalize BEFORE validating and keying: everything downstream
          // (ingestion, availability, the pre-charge tuple checks) compares
          // against lowercase hex, so an uppercase policy id must not be
          // silently dropped as invalid — it is the same source.
          const policyId = source.policyId?.toLowerCase();
          const smartContractAddress =
            source.smartContractAddress?.toLowerCase();
          if (
            source.isPurchaseReady &&
            policyId &&
            CARDANO_POLICY_ID_PATTERN.test(policyId) &&
            smartContractAddress
          ) {
            const readySource = {
              policyId,
              smartContractAddress,
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

    /**
     * x402 EVM chains the node reports accessible for this environment.
     * Filtered node-side to the client's environment: the Cardano
     * Preprod/Mainnet split maps onto the node's testnet/mainnet flag
     * (PR1-SPEC §6). Raw node rows — buy-side readiness composition
     * (enabled + funded budget) happens in the caller.
     */
    async getX402AvailableNetworks(
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<X402AvailableNetwork[], string>> {
      try {
        const response = await getX402NetworksAvailable({
          client: client(),
          query: { isTestnet: network === "Preprod" ? "true" : "false" },
          signal: options.signal,
        });
        if (response.error || !response.data) {
          return err(
            `x402 networks/available ${response.response?.status ?? "unknown"}: ${extractNodeErrorMessage(response.error)}`,
          );
        }
        return ok(response.data.data.Networks);
      } catch (error) {
        return err(String(error) || "Failed to get x402 available networks");
      }
    },

    /**
     * x402 wallet budgets this API key can actually draw on at pay time.
     *
     * Verified against masumi-payment-service `main`
     * (`src/routes/api/x402/index.ts`): `GET /x402/budgets` requires ADMIN
     * permission (`adminAuthenticatedEndpointFactory`) — a plain pay key is
     * rejected outright — and its handler
     * (`listX402WalletBudgets(input.apiKeyId)`) returns EVERY key's budget
     * rows unless the optional `apiKeyId` query filter is passed; it is
     * never scoped to the caller. `POST /x402/pay`, however, only draws on
     * budgets whose `apiKeyId` equals the calling key (`pay.ts`,
     * `createX402Payment`). So this method resolves its own key id via
     * `GET /api-key-status` and filters server-side: a foreign key's budget
     * must never mark a (network, asset) pair buy-side ready. Raw node
     * rows — see getX402AvailableNetworks.
     */
    async getX402Budgets(
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<X402Budget[], string>> {
      try {
        const statusResponse = await getApiKeyStatus({
          client: client(),
          signal: options.signal,
        });
        if (statusResponse.error || !statusResponse.data) {
          return err(
            `api-key-status ${statusResponse.response?.status ?? "unknown"}: ${extractNodeErrorMessage(statusResponse.error)}`,
          );
        }
        // Runtime guard, not just the generated type: a version-skewed node
        // answering 200 with a missing/empty id would make the query
        // serializer silently DROP the apiKeyId param, turning this into the
        // unscoped admin read this whole resolution exists to prevent.
        const apiKeyId: unknown = statusResponse.data.data?.id;
        if (typeof apiKeyId !== "string" || apiKeyId.length === 0) {
          return err(
            "api-key-status returned no key id; refusing unscoped budgets read",
          );
        }
        const response = await getX402BudgetsRequest({
          client: client(),
          query: { apiKeyId },
          signal: options.signal,
        });
        if (response.error || !response.data) {
          return err(
            `x402 budgets ${response.response?.status ?? "unknown"}: ${extractNodeErrorMessage(response.error)}`,
          );
        }
        return ok(response.data.data.Budgets);
      } catch (error) {
        return err(String(error) || "Failed to get x402 budgets");
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
    ): Promise<Result<PostPurchaseResponses["200"]["data"], PurchaseFailure>> {
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
          const status = response.response?.status;
          return err({
            kind: classifyPurchaseFailureKind(status),
            message: `Failed to create purchase request (status ${status ?? "unknown"}): ${extractNodeErrorMessage(response.error)}`,
            status,
          });
        }

        return ok(response.data.data);
      } catch (error) {
        return err({
          kind: "ambiguous",
          message: String(error) || "Failed to create purchase request",
        });
      }
    },

    async createPurchaseFromMasumiTaskPayment(
      input: MasumiTaskPurchaseInput,
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<CreatedPurchase, PurchaseFailure>> {
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
        const body = buildTaskPurchaseRequest(input);
        const response = await postPurchase({
          client: client(),
          body,
          signal: options.signal,
        });

        if (response.error || !response.data) {
          const status = response.response?.status;
          if (response.response?.status === 409) {
            console.info(`${logLabel} purchase already exists`, {
              network,
              blockchainIdentifier: input.blockchainIdentifier,
            });
            const resolved = await resolveTaskPurchase(body, options);
            if (resolved.isOk()) {
              return ok(resolved.value);
            }
            return err({
              kind:
                resolved.error.kind === "ambiguous" ? "ambiguous" : "permanent",
              message: resolved.error.message,
              status,
            });
          }
          console.error(`${logLabel} payment API error`, {
            network,
            blockchainIdentifier: input.blockchainIdentifier,
            error: response.error,
          });
          // The event is already charged when this error surfaces. Carry the
          // node's status and reason into compensation and alerting.
          return err({
            kind: classifyPurchaseFailureKind(status),
            message: `Failed to create purchase request (status ${status ?? "unknown"}): ${extractNodeErrorMessage(response.error)}`,
            status,
          });
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
        return err({
          kind: "ambiguous",
          message: String(error) || "Failed to create purchase request",
        });
      }
    },

    async resolveMasumiTaskPaymentPurchase(
      input: MasumiTaskPurchaseInput,
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<CreatedPurchase, TaskPurchaseResolutionFailure>> {
      return resolveTaskPurchase(buildTaskPurchaseRequest(input), options);
    },
  };
}
