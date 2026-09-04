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
import { createX402PaymentMethods } from "./masumi-payment-x402.js";
import { extractNodeErrorMessage, readNodeErrorMessage } from "./node-error.js";
import { createClient } from "./openapi/generated/payment/client/index.js";
import {
  type GetPurchaseDiffResponses,
  getPurchaseDiff,
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

export interface CardanoV2ReadySource {
  policyId: string;
  smartContractAddress: string;
}

type ResolvedPurchase =
  PostPurchaseResolveBlockchainIdentifierResponses["200"]["data"];

/**
 * One purchase as returned by the node's diff feed. Structurally the same row
 * the resolve endpoint returns, plus the change timestamps the cursor rides
 * on.
 */
export type MasumiPurchaseDiffEntry =
  GetPurchaseDiffResponses["200"]["data"]["Purchases"][number];

/**
 * A failed diff request. The status rides alongside the message because the
 * caller's paging policy branches on it. `hasNodeErrorEnvelope` records whether
 * the payment node supplied its documented `{ error: { message } }` envelope.
 * A node-owned response must still page when its status also looks like a
 * transient proxy status. `status` is null when no response arrived.
 */
export interface MasumiPurchaseDiffFailure {
  hasNodeErrorEnvelope: boolean;
  message: string;
  status: number | null;
}

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
     * Purchases whose next action, on-chain state, or result changed at or
     * after `changedSince`, oldest first. `cursorId` breaks the tie when
     * several purchases carry the same change timestamp, so a page boundary
     * cannot drop or repeat a row.
     *
     * No payment-source filter is sent, so both rails inside the API key's
     * wallet scope can come back. That is deliberate but version-bound.
     *
     * `GET /purchase`, `/payment/diff` and `/registry/diff` each default to
     * Web3CardanoV1 when neither `filterPaymentSourceType` nor
     * `filterSmartContractAddress` is given. `/purchase/diff` has no such
     * default.
     *
     * VERIFIED against masumi-payment-service `5416f92fb^`: the deployed route
     * applies deletedAt, network, smartContractAddress, and the API key's wallet
     * scope. It does not filter payment source, so both rails inside that wallet
     * scope arrive in one feed. The configured key must cover every purchasing
     * wallet Sokosumi uses (`src/routes/api/purchases/diff/index.ts`,
     * buildPurchaseDiffWhere).
     *
     * If that route ever gains `filterPaymentSourceType`, this call has to page
     * each rail with its own cursor, because the node resolves one source type
     * per request and Sokosumi runs V1 and V2 side by side.
     */
    async getPurchasesDiff(
      changedSince: Date,
      cursorId: string | null,
      limit: number,
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<MasumiPurchaseDiffEntry[], MasumiPurchaseDiffFailure>> {
      try {
        const response = await getPurchaseDiff({
          client: client(),
          query: {
            network,
            lastUpdate: changedSince.toISOString(),
            cursorId: cursorId ?? undefined,
            limit,
          },
          signal: options.signal,
        });
        const status = response.response?.status ?? null;
        if (
          response.error ||
          !response.data ||
          response.response?.status !== 200
        ) {
          const nodeErrorMessage = readNodeErrorMessage(response.error);
          return err({
            hasNodeErrorEnvelope: nodeErrorMessage !== null,
            message: `purchase-diff ${status ?? "unknown"}: ${nodeErrorMessage ?? extractNodeErrorMessage(response.error)}`,
            status,
          });
        }
        const purchases = response.data.data.Purchases;
        const invalidCursorPurchase = purchases.find((purchase) => {
          const changedAt =
            purchase.nextActionOrOnChainStateOrResultLastChangedAt;
          const createdAt = purchase.createdAt;
          return (
            !(changedAt instanceof Date) ||
            Number.isNaN(changedAt.getTime()) ||
            !(createdAt instanceof Date) ||
            Number.isNaN(createdAt.getTime()) ||
            changedAt.getTime() < createdAt.getTime()
          );
        });
        if (invalidCursorPurchase) {
          // A 200 the node itself served: the body is wrong, not the far side
          // absent, so this must stay pageable.
          return err({
            hasNodeErrorEnvelope: false,
            message: `purchase-diff 200: invalid change timestamp for purchase ${invalidCursorPurchase.id}`,
            status,
          });
        }
        return ok(purchases);
      } catch (error) {
        return err({
          hasNodeErrorEnvelope: false,
          message: String(error) || "Failed to fetch the purchase diff",
          status: null,
        });
      }
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

    ...createX402PaymentMethods(client, network),

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
