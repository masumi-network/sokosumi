import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import type { X402PaymentRequired } from "../schemas/x402/payment-required.schema.js";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "../utils/caip19.js";
import { extractNodeErrorMessage, readNodeErrorMessage } from "./node-error.js";
import type { Client } from "./openapi/generated/payment/client/index.js";
import {
  type GetX402NetworksAvailableResponses,
  type GetX402WalletsBalanceResponses,
  type GetX402WalletsResponses,
  getApiKeyStatus,
  getX402NetworksAvailable,
  getX402Wallets,
  getX402WalletsBalance,
  type PostX402PayData,
  type PostX402PayResponses,
  postX402Pay,
} from "./openapi/generated/payment/index.js";

/** Exported so `createPaymentClient`'s spread return type stays nameable. */
export interface PaymentClientRequestOptions {
  signal?: AbortSignal;
}

/** One x402 EVM chain the node reports accessible (`GET /x402/networks/available`). */
export type X402AvailableNetwork =
  GetX402NetworksAvailableResponses["200"]["data"]["Networks"][number];

/**
 * The calling key's x402 spend cap, read from `GET /api-key-status`.
 *
 * The node caps x402 spend on the API KEY, never on a wallet: one credit
 * ledger per key, keyed by `eip155:<chainId>:<asset>` units, gated by
 * `usageLimited` (masumi ADR 0016). The unit string is byte-identical to the
 * `<caip2Network>:<asset>` pair key Core composes readiness on, so a cap
 * lookup is a plain map get.
 */
export interface X402KeySpendCaps {
  /** The node enforces a cap only when true. */
  usageLimited: boolean;
  /**
   * Remaining credit per lowercased `eip155:<chainId>:<asset>` unit, summed
   * across rows: nothing enforces one row per (key, unit) on the node, so a
   * split ledger must be judged by its total, exactly as the node's own
   * debit path does.
   */
  creditsByUnit: ReadonlyMap<string, bigint>;
  /**
   * The key is `usageLimited` but holds NO `eip155:` row at all, so the node
   * grandfathers it to uncapped x402 spend and warns per payment. Distinct
   * from "capped at zero": this key can pay, a zero-credit one cannot.
   */
  grandfatheredUncapped: boolean;
}

/** One managed EVM wallet visible to the calling key (`GET /x402/wallets`). */
export type X402Wallet =
  GetX402WalletsResponses["200"]["data"]["Wallets"][number];

/** One chain balance returned for a managed EVM wallet. */
export type X402WalletBalance =
  GetX402WalletsBalanceResponses["200"]["data"]["Balances"][number];

export interface X402WalletBalanceInput {
  evmWalletId: string;
  evmWalletAddress: string;
  caip2Network: string;
}

// The canonical patterns, not private copies: a laxer local caip2 regex once
// accepted leading-zero spellings ("eip155:08453") that Core's readiness
// composition then silently dropped — the client vouched for rows the rest of
// the pipeline could never bind.
const caip2EvmNetworkSchema = z.string().regex(CAIP2_EVM_NETWORK_PATTERN);
const evmAddressSchema = z.string().regex(EVM_ADDRESS_PATTERN);
/**
 * Digit ceiling for any base-unit amount the node reports.
 *
 * An EVM balance cannot exceed max uint256, which is 78 digits, so 80 clears
 * every real value with room to spare. The bound is not cosmetic: `BigInt()`
 * is superlinear in digit count, so an unbounded digit string from the far
 * side is CPU the sync worker spends on a value that cannot be a balance.
 */
const MAX_BASE_UNIT_DIGITS = 80;

const baseUnitAmountSchema = z
  .string()
  .regex(/^\d+$/)
  .max(MAX_BASE_UNIT_DIGITS);
const assetDecimalsSchema = z.number().int().min(0).max(255);
const nodeDateSchema = z.union([
  z.date(),
  z.iso.datetime().transform((value) => new Date(value)),
]);

const x402AvailableNetworkSchema: z.ZodType<X402AvailableNetwork> = z.object({
  id: z.string().min(1),
  caip2Id: caip2EvmNetworkSchema,
  displayName: z.string().min(1),
  isTestnet: z.boolean(),
  isEnabled: z.boolean(),
  canSettle: z.boolean(),
  defaultAsset: evmAddressSchema.nullable(),
  defaultAssetDecimals: assetDecimalsSchema.nullable(),
});

/**
 * One `RemainingUsageCredits` row from `GET /api-key-status`.
 *
 * Shape only. The node really can hold an `amount` that is not a base-unit
 * integer, and such a row is judged per unit below (it ends grandfathering
 * but adds nothing to its unit's sum) rather than failing the whole read, so
 * the digit check deliberately stays out of this schema. Validating the shape
 * here is what keeps an absent or version-skewed array from reading as "this
 * key holds no credits".
 */
const apiKeyUsageCreditSchema = z.object({
  unit: z.string(),
  amount: z.string(),
});

/**
 * Row ceiling for `RemainingUsageCredits`.
 *
 * One row is one `<caip2Network>:<asset>` unit the key holds credit in, so a
 * real key has a handful. Thousands is version skew or a node fault, and the
 * loop below turns every row into a `BigInt`. Refusing the read fails closed,
 * which is the same direction every other guard here takes.
 */
const MAX_USAGE_CREDIT_ROWS = 1_000;

const x402WalletSchema: z.ZodType<X402Wallet> = z.object({
  id: z.string().min(1),
  networkId: z.string().min(1),
  caip2Network: caip2EvmNetworkSchema,
  address: evmAddressSchema,
  type: z.enum(["Purchasing", "Selling"]),
  note: z.string().nullable(),
  createdById: z.string().min(1).nullable(),
  createdAt: nodeDateSchema,
  updatedAt: nodeDateSchema,
});

const x402WalletBalanceSchema: z.ZodType<X402WalletBalance> = z.object({
  caip2Network: caip2EvmNetworkSchema,
  displayName: z.string().min(1),
  native: z
    .object({
      symbol: z.string().min(1),
      decimals: assetDecimalsSchema,
      amount: baseUnitAmountSchema,
    })
    .nullable(),
  asset: z
    .object({
      asset: evmAddressSchema,
      symbol: z.string().min(1).nullable(),
      decimals: assetDecimalsSchema,
      amount: baseUnitAmountSchema,
    })
    .nullable(),
  error: z.string().nullable(),
});

function validateNodeRows<T>(
  rows: unknown,
  rowSchema: z.ZodType<T>,
  collectionName: string,
): Result<T[], string> {
  if (!Array.isArray(rows)) {
    return err(`x402 ${collectionName} returned no ${collectionName} array`);
  }
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) {
    return err(`x402 ${collectionName} returned a malformed row`);
  }
  return ok(parsed.data);
}

const X402_NODE_REFUSAL_STATUSES = new Set([400, 402, 500]);

/**
 * Wallet page size AND the ambiguity guard's threshold — one constant, one
 * invariant: the "full page may hide another wallet" check below is only
 * correct while it compares against the exact page size requested. Raising
 * the fetch size without the guard fires spurious ambiguity errors; raising
 * the guard without the fetch silently disables the check and lets readiness
 * rank signers over a listing it cannot see all of.
 */
const X402_WALLET_PAGE_SIZE = 100;

/** The node's signed x402 payment (`POST /x402/pay` 200 data). */
export type X402SignedPayment = PostX402PayResponses["200"]["data"];

export interface X402PayInput {
  /** Managed EVM wallet the node signs with — Soko-owned, never caller-supplied. */
  evmWalletId: string;
  /** The normalized (v2-shaped) 402 payload — see normalizeX402PaymentRequired. */
  paymentRequired: X402PaymentRequired;
  /** Restrict signing to the verified CAIP-2 network. */
  preferredNetwork?: string;
  /** Restrict signing to the verified token asset. */
  preferredAsset?: string;
  /**
   * Correlation echo stamped into the signed payload's extensions. Send ONLY
   * when the 402 advertises the payment-identifier extension — the node 400s
   * otherwise (ticket 011 Q2).
   */
  paymentIdentifier?: string;
}

/**
 * A failed `/x402/pay` call. `kind` — not the message — is what callers
 * branch on (ticket 011 Q1):
 *
 * - `"refused"`: THE NODE answered, with a non-200 status and its own
 *   documented `{ error: { message } }` envelope. No header was issued, so
 *   the payment is provably unpaid and a synchronous credit refund is always
 *   safe. `status` carries the node's HTTP status (400 = deterministic
 *   pre-sign rejection, 402 = usage-credit/balance refusal, 500 = config/signing
 *   failure) — the only three the spec declares. That a 500 + envelope
 *   proves "no header was issued" — i.e. the node's pay handler cannot 500
 *   AFTER its wallet signed — is a node-source-verified contract, recorded
 *   with its 2026-08-17 safety correction in
 *   `docs/wayfinder/x402-evm/NODE-QUESTIONS.md` (Answers, item 1). If that
 *   contract ever weakens, 500 must move to the ambiguous branch.
 * - `"ambiguous"`: no usable response (transport error, abort, a malformed
 *   200, or a non-200 that did not come from the node's own handler). A
 *   header may exist that Soko never received — still unsettleable from the
 *   buyer's side, but the record should stay PENDING for the reconciler
 *   instead of refunding inline.
 *
 * The envelope requirement is what keeps the refusal premise honest. A
 * 502/503/504/408 from a reverse proxy or load balancer in front of the node
 * is indistinguishable from a node status by number alone, and it can be
 * produced AFTER the node signed — so classifying it "refused" would refund
 * and close the row against a live authorization, then push the coworker onto
 * a new key for a second charge and a second signature. Erring toward
 * ambiguous is the doctrine-aligned direction: hold PENDING, never refund.
 */
export interface X402PayFailure {
  kind: "refused" | "ambiguous";
  status?: number;
  message: string;
  /**
   * The node's OWN `error.message`, set only on a `"refused"` — i.e. only
   * when the node's documented envelope was present.
   *
   * Separate from `message`, which is a composed log line built on
   * `extractNodeErrorMessage` and therefore may contain a JSON dump of the
   * entire far-side body. A caller echoing anything back to the coworker must
   * use THIS field, so a body carrying wallet or credit internals cannot
   * reach a response.
   */
  nodeMessage?: string;
}

type PostX402PayBody = NonNullable<PostX402PayData["body"]>;

/**
 * The signed-tuple fields a VERIFIED record and its stored replay depend on.
 * Every one must be a present, non-empty string on a usable 200.
 *
 * `payer` is here, not merely nice-to-have: the caller writes it to
 * `TaskX402Payment.payerAddress`, and Prisma treats `undefined` as "skip the
 * column". An absent payer therefore leaves that column NULL, which silently
 * disables the partial
 * `[caip2Network, asset, payerAddress, payloadNonce]` nonce-replay unique for
 * the row (Postgres NULLs are distinct, so the index can never collide).
 */
const REQUIRED_SIGNED_PAYMENT_STRING_FIELDS = [
  "attemptId",
  "xPaymentHeader",
  "caip2Network",
  "asset",
  "amount",
  "payTo",
  "payer",
  "paymentPayloadHash",
] as const;

/**
 * First signed-tuple field that is missing or the wrong shape on a 200 body,
 * or null when the payload is complete. A version-skewed node can answer 200
 * with a field absent/empty; forwarding that as SIGNED writes a VERIFIED
 * record with a null header — unrecoverable (route 500s, every replay 500s,
 * refund refuses VERIFIED). Mirrors the api-key-status version-skew guard:
 * trust the runtime value, not the generated type.
 */
function firstMissingSignedField(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return "data";
  }
  const record = data as Record<string, unknown>;
  for (const field of REQUIRED_SIGNED_PAYMENT_STRING_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
      return field;
    }
  }
  // `paymentPayload` is the one field that must be a real object: it is
  // `required` in the node's own 200 schema and callers dereference it, so a
  // skewed 200 without it produced a TypeError — an unhandled 500 holding the
  // charge while the header the node DID issue was thrown away. Arrays are
  // objects too, but no signed payload is an array — and reading `.payload`
  // off one yields undefined, the same silent-hole failure this guard stops.
  const paymentPayload = record.paymentPayload;
  if (
    typeof paymentPayload !== "object" ||
    paymentPayload === null ||
    Array.isArray(paymentPayload)
  ) {
    return "paymentPayload";
  }
  return null;
}

/**
 * Awaits `promise`, but rejects as soon as `signal` aborts — WITHOUT
 * cancelling the underlying work. For promises shared between callers
 * (the memoized api-key-status fetch): the aborting caller gets its abort
 * semantics, everyone else keeps the result.
 */
function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new Error("The operation was aborted"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new Error("The operation was aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason);
      },
    );
  });
}

/**
 * x402 buy-side methods of the payment client. Split from
 * `createPaymentClient`'s Cardano surface by responsibility; spread into the
 * returned client object so callers see one client.
 */
export function createX402PaymentMethods(
  client: () => Client,
  network: "Preprod" | "Mainnet",
) {
  /**
   * The one `GET /api-key-status` resolution both cap- and wallet-scoped
   * reads depend on, memoized per methods instance.
   *
   * The key identity is fixed for the instance's lifetime (it is baked into
   * `client()`), so a successful answer cannot go stale faster than the
   * instance itself — callers that must re-observe a node-side permission
   * change simply build a fresh client. Failures are NEVER memoized: a
   * transient transport error must not poison every later call on the
   * instance. The in-flight promise is shared too, so concurrent callers
   * (readiness fires spend caps and wallets together) produce one status
   * request, not one each.
   *
   * The shared fetch deliberately carries NO AbortSignal, and it never
   * rejects (thrown transport errors become `err(...)`). Passing the first
   * caller's signal into a fetch other callers share would let one caller's
   * abort fail everyone (and leave a rejected promise memoized behind it).
   * Instead each caller races the shared promise against its OWN signal in
   * `resolveApiKeyStatus`, so an abort affects exactly the caller that asked
   * for it while the fetch completes for the rest.
   */
  let memoizedApiKeyStatus: ReturnType<typeof fetchApiKeyStatus> | null = null;

  async function fetchApiKeyStatus() {
    try {
      const statusResponse = await getApiKeyStatus({ client: client() });
      if (statusResponse.error || !statusResponse.data) {
        return err(
          `api-key-status ${statusResponse.response?.status ?? "unknown"}: ${extractNodeErrorMessage(statusResponse.error)}`,
        );
      }
      return ok(statusResponse.data.data);
    } catch (error) {
      return err(String(error) || "Failed to get api-key-status");
    }
  }

  function resolveApiKeyStatus(options: PaymentClientRequestOptions) {
    if (options.signal?.aborted) {
      // An already-aborted caller must not fire the shared fetch at all —
      // it is going away (typically shutdown), and warming the memo for
      // callers that do not exist yet is not worth issuing a request the
      // aborter explicitly asked not to make.
      return Promise.reject(
        options.signal.reason ?? new Error("The operation was aborted"),
      );
    }
    if (!memoizedApiKeyStatus) {
      const inFlight: ReturnType<typeof fetchApiKeyStatus> =
        fetchApiKeyStatus().then((result) => {
          // Cleared at the SOURCE, not by whichever caller happens to await:
          // an aborted caller races away before observing the result, and a
          // failure it never saw must still not stay memoized.
          if (result.isErr() && memoizedApiKeyStatus === inFlight) {
            memoizedApiKeyStatus = null;
          }
          return result;
        });
      memoizedApiKeyStatus = inFlight;
    }
    return raceWithAbort(memoizedApiKeyStatus, options.signal);
  }

  return {
    /**
     * x402 EVM chains the node reports accessible for this environment.
     * Filtered node-side to the client's environment: the Cardano
     * Preprod/Mainnet split maps onto the node's testnet/mainnet flag
     * (PR1-SPEC §6). Raw node rows — buy-side readiness composition
     * (enabled + funded wallet + key credit) happens in the caller.
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
        // Runtime guard, not just the generated type: a version-skewed 200
        // with `data` present but `Networks` absent would return ok(undefined)
        // and crash the caller's iteration. Treat a non-array as an error.
        return validateNodeRows(
          response.data.data.Networks,
          x402AvailableNetworkSchema,
          "Networks",
        );
      } catch (error) {
        return err(String(error) || "Failed to get x402 available networks");
      }
    },

    /**
     * The calling key's x402 spend cap.
     *
     * Reads the SAME memoized `GET /api-key-status` every other scoped call
     * here already resolves, so this costs no extra request. It replaces the
     * removed `GET /x402/budgets`: masumi ADR 0016 made per-key usage credits
     * the only x402 spend cap and deleted per-wallet budgets outright.
     *
     * Scoping is structural rather than filtered. `api-key-status` answers
     * for the CALLING key only, so there is no foreign-row hazard of the kind
     * the budgets read defended against with an explicit `apiKeyId` query
     * filter plus a re-filter of the response.
     *
     * Non-`eip155:` rows are dropped: those are the Cardano rail's credits on
     * the same shared ledger and must never make an EVM pair look payable. A
     * non-numeric amount contributes nothing to its unit's sum, so a unit
     * whose only row is unparsable reads as zero and its pair is delisted.
     * That is the fail-closed direction: a malformed amount is not evidence
     * of funding.
     */
    async getX402KeySpendCaps(
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<X402KeySpendCaps, string>> {
      try {
        const statusResult = await resolveApiKeyStatus(options);
        if (statusResult.isErr()) {
          return err(statusResult.error);
        }
        const status = statusResult.value;
        // Version-skew guard, same posture as the wallet listing's strict
        // flag read: a node answering 200 without the flag must not read as
        // "uncapped" and mark pairs ready that a capped key cannot pay.
        if (typeof status?.usageLimited !== "boolean") {
          return err(
            "api-key-status returned no usageLimited flag; refusing to judge x402 spend caps",
          );
        }
        // Zod, like every other node read here, and for the same reason the
        // flag above is guarded: `RemainingUsageCredits` is required, so an
        // absent or malformed array is version skew, never "this key holds no
        // credits". Reading it as an empty list would set
        // `grandfatheredUncapped` on a usageLimited key and mark every pair
        // ready that the node would then refuse with a 402.
        const creditRows = z
          .array(apiKeyUsageCreditSchema)
          .max(MAX_USAGE_CREDIT_ROWS)
          .safeParse(status.RemainingUsageCredits);
        if (!creditRows.success) {
          return err(
            "api-key-status returned no usable RemainingUsageCredits array; refusing to judge x402 spend caps",
          );
        }
        const creditsByUnit = new Map<string, bigint>();
        let sawEvmRow = false;
        for (const row of creditRows.data) {
          const unit = row.unit.toLowerCase();
          if (!unit.startsWith("eip155:")) {
            continue;
          }
          // Any eip155 row at all ends grandfathering on the node, including
          // one this loop then drops as unparsable: the node COUNTS those
          // rows, it does not parse them. Reading that as still-grandfathered
          // would call a hard-capped key uncapped.
          sawEvmRow = true;
          // Length first: an over-long amount is dropped exactly like an
          // unparsable one, so its unit reads as zero and the pair delists.
          // Checking before BigInt is the point, since that is the
          // superlinear call.
          if (
            row.amount.length > MAX_BASE_UNIT_DIGITS ||
            !/^\d+$/.test(row.amount)
          ) {
            continue;
          }
          creditsByUnit.set(
            unit,
            (creditsByUnit.get(unit) ?? 0n) + BigInt(row.amount),
          );
        }
        return ok({
          usageLimited: status.usageLimited,
          creditsByUnit,
          grandfatheredUncapped: status.usageLimited && !sawEvmRow,
        });
      } catch (error) {
        return err(String(error) || "Failed to get x402 key spend caps");
      }
    },

    /**
     * Purchasing wallets the calling key can sign from.
     *
     * WHICH wallets: the node scopes `GET /x402/wallets` server-side and
     * applies the SAME owner scope to `POST /x402/pay`. An admin key reaches
     * every wallet, and so does a non-admin key with wallet scoping off: an
     * absent scope list means unrestricted, the node's Cardano-parity default
     * (`buildOwnerScopeWhere`). Only a key with wallet scoping ON is narrowed,
     * to the wallets it created plus any an admin assigned to it via
     * `ApiKeyX402WalletScope` (masumi ADR 0016). There is deliberately no
     * `canAdmin` gate on that: the old one existed because a non-admin key had
     * no legitimate uncapped path and budgets were the only grant, and with
     * budgets gone a scoped non-admin key is a first-class signer.
     *
     * WHETHER it may pay: the owner scope matches on both endpoints, the
     * PERMISSION TIER does not. `GET /x402/wallets` is read-authenticated and
     * `POST /x402/pay` is pay-authenticated (`payment-core/src/auth.ts`), and
     * read is satisfied by `canRead || canPay`. So a read-only key lists
     * wallets it can never sign with, and readiness composed off that listing
     * would publish pairs whose every charge 401s, a status the pay path
     * classifies as AMBIGUOUS, so the record is held for the reconciler rather
     * than refunded. Gate on the tier the node itself applies: `hasPermission`
     * returns true for any admin key (`payment-core/src/permissions.ts`), so
     * admin counts as pay. Strict equality keeps a version-skewed status
     * fail-closed, and an empty listing composes zero ready pairs rather than
     * leaving a stale, unpayable set in the cache.
     *
     * HOW MUCH: capped separately and key-globally by
     * {@link getX402KeySpendCaps}. This listing answers "which wallet can
     * sign", never "how much may it spend".
     */
    async getX402PurchasingWallets(
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<X402Wallet[], string>> {
      try {
        const statusResult = await resolveApiKeyStatus(options);
        if (statusResult.isErr()) {
          return err(statusResult.error);
        }
        const status = statusResult.value;
        if (status?.canPay !== true && status?.canAdmin !== true) {
          return ok([]);
        }

        const response = await getX402Wallets({
          client: client(),
          query: { take: X402_WALLET_PAGE_SIZE, type: "Purchasing" },
          signal: options.signal,
        });
        if (response.error || !response.data) {
          return err(
            `x402 wallets ${response.response?.status ?? "unknown"}: ${extractNodeErrorMessage(response.error)}`,
          );
        }
        const walletsResult = validateNodeRows(
          response.data.data.Wallets,
          x402WalletSchema,
          "Wallets",
        );
        if (walletsResult.isErr()) {
          return walletsResult;
        }
        const wallets = walletsResult.value;
        // A full page may hide another wallet on the next page, and readiness
        // RANKS wallets: an unseen better-funded one would silently change
        // which signer wins, so a partial listing is not a safe input. Fail
        // closed until pagination is needed in practice.
        if (wallets.length >= X402_WALLET_PAGE_SIZE) {
          return err(
            "x402 purchasing wallet list reached its safety limit; refusing to rank signers over a partial listing",
          );
        }
        // Re-filter the response: a node that ignores the request filter must
        // never let a Selling/facilitator wallet become an outbound signer.
        return ok(wallets.filter((wallet) => wallet.type === "Purchasing"));
      } catch (error) {
        return err(String(error) || "Failed to get x402 purchasing wallets");
      }
    },

    /**
     * Native gas and default-token balances for one managed EVM wallet.
     * Readiness uses both: token funds cannot settle without gas, and gas
     * alone cannot cover the requested asset transfer.
     */
    async getX402WalletBalances(
      input: X402WalletBalanceInput,
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<X402WalletBalance[], string>> {
      try {
        const response = await getX402WalletsBalance({
          client: client(),
          query: {
            id: input.evmWalletId,
            caip2Network: input.caip2Network,
          },
          signal: options.signal,
        });
        if (response.error || !response.data) {
          return err(
            `x402 wallet balance ${response.response?.status ?? "unknown"}: ${extractNodeErrorMessage(response.error)}`,
          );
        }
        const data = response.data.data;
        if (data.evmWalletId !== input.evmWalletId) {
          return err("x402 wallet balance returned a different wallet id");
        }
        const addressResult = evmAddressSchema.safeParse(data.address);
        if (!addressResult.success) {
          return err("x402 wallet balance returned a malformed wallet address");
        }
        if (
          addressResult.data.toLowerCase() !==
          input.evmWalletAddress.toLowerCase()
        ) {
          return err("x402 wallet balance returned a different wallet address");
        }
        const balancesResult = validateNodeRows(
          data.Balances,
          x402WalletBalanceSchema,
          "Balances",
        );
        if (balancesResult.isErr()) {
          return balancesResult;
        }
        if (balancesResult.value.some((balance) => balance.error !== null)) {
          return err("x402 wallet balance lookup returned a chain error");
        }
        return balancesResult;
      } catch (error) {
        return err(String(error) || "Failed to get x402 wallet balances");
      }
    },

    /**
     * Signs an x402 payment through `POST /x402/pay` and returns the
     * `X-PAYMENT` header material.
     *
     * Never throws. Error taxonomy per ticket 011 Q1: the node signs locally
     * and never sends the buyer's request, so a non-200 answer CARRYING THE
     * NODE'S OWN ERROR ENVELOPE means no header was issued (`"refused"`,
     * refund-safe inline), while a transport failure, a malformed 200, or a
     * non-200 from anything but the node's handler means the outcome was not
     * observed (`"ambiguous"`, the caller's PENDING record is the
     * reconciler's job). See {@link X402PayFailure}.
     */
    async payX402(
      input: X402PayInput,
      options: PaymentClientRequestOptions = {},
    ): Promise<Result<X402SignedPayment, X402PayFailure>> {
      const logLabel = "[masumi-payment] payX402";
      try {
        const body: PostX402PayBody = {
          evmWalletId: input.evmWalletId,
          paymentRequired: input.paymentRequired,
          ...(input.preferredNetwork !== undefined
            ? { preferredNetwork: input.preferredNetwork }
            : {}),
          ...(input.preferredAsset !== undefined
            ? { preferredAsset: input.preferredAsset }
            : {}),
          ...(input.paymentIdentifier !== undefined
            ? { paymentIdentifier: input.paymentIdentifier }
            : {}),
        };
        const response = await postX402Pay({
          client: client(),
          body,
          signal: options.signal,
        });

        const status = response.response?.status;
        if (response.error || !response.data) {
          // A non-200 FROM THE NODE is a refusal: "Local signing only — this
          // service never sends the buyer's request" (node pay.ts), so no
          // header exists and nothing can settle.
          //
          // "From the node" is established by its own error envelope, not by
          // the status number. The status alone cannot tell a node 500 from a
          // gateway 502 raised after the node already signed, and only the
          // former licenses the synchronous refund. Anything else — an HTML
          // error page, a bare string, a differently-shaped JSON body — falls
          // through to ambiguous, which holds PENDING and never refunds.
          //
          // A 200 whose body we cannot use is likewise NOT provably refused —
          // the header may have been issued — so it stays ambiguous too.
          const nodeMessage = readNodeErrorMessage(response.error);
          if (
            status !== undefined &&
            X402_NODE_REFUSAL_STATUSES.has(status) &&
            nodeMessage !== null
          ) {
            console.error(`${logLabel} refused`, {
              network,
              status,
              error: response.error,
            });
            return err({
              kind: "refused",
              status,
              message: `x402 pay refused (status ${status}): ${nodeMessage}`,
              nodeMessage,
            });
          }
          console.error(`${logLabel} unusable response`, {
            network,
            status,
            error: response.error,
          });
          return err({
            kind: "ambiguous",
            status,
            message: `x402 pay returned no usable result (status ${status ?? "unknown"}): ${extractNodeErrorMessage(response.error)}`,
          });
        }

        const data = response.data.data;
        // A 200 whose signed tuple is incomplete is NOT provably refused (a
        // header may exist) — so it stays ambiguous, never a refusal that
        // would trigger an inline refund. It must never flow through as
        // SIGNED: finalizing a partial 200 corrupts the record irrecoverably.
        const missingField = firstMissingSignedField(data);
        if (missingField) {
          console.error(`${logLabel} incomplete 200`, {
            network,
            status,
            missingField,
          });
          return err({
            kind: "ambiguous",
            status,
            message: `x402 pay returned a 200 with an incomplete signed payload (missing/empty ${missingField})`,
          });
        }
        console.info(`${logLabel} signed`, {
          network,
          attemptId: data.attemptId,
          caip2Network: data.caip2Network,
        });
        return ok(data);
      } catch (error) {
        // Thrown fetch/abort: the request may or may not have reached the
        // node — outcome unknown, never a refusal.
        console.error(`${logLabel} unexpected error`, { network, error });
        return err({
          kind: "ambiguous",
          message: String(error) || "Failed to sign x402 payment",
        });
      }
    },
  };
}
