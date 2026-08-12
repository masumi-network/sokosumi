/**
 * The WILD side of the 402 "Payment Required" normalizer: what a resource
 * server may actually send, and how one offered requirement is translated into
 * the node's shape.
 *
 * Split out of `payment-required.schema.ts` (which kept that file over the
 * 750-line ceiling) because it answers a different question. The schema file
 * owns what Soko may EMIT — the node's v2 `paymentRequired` shape and the
 * payload-level entry points built on it. This file owns what Soko may READ:
 * the lenient v1/v2 dialect shapes, the per-field translations
 * (`maxAmountRequired` → `amount`, plain network name → CAIP-2, address
 * canonicalization) and the shadow-key filter that decides which of an entry's
 * unknown keys are safe to forward.
 *
 * Everything here is attacker-authored input. Nothing guesses: a value that
 * cannot be translated is an error, never a default.
 */

import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "../../utils/caip19.js";
import {
  BOUNDED_MAP_MESSAGE,
  boundedMapCheck,
  truncateEcho,
  X402_MAX_ACCEPTS_ENTRIES,
  X402_MAX_AMOUNT_BASE_UNITS,
  X402_MAX_AMOUNT_DIGITS,
  X402_MAX_ERROR_LENGTH,
  X402_MAX_RAW_ADDRESS_LENGTH,
  X402_MAX_RAW_AMOUNT_LENGTH,
  X402_MAX_RAW_NETWORK_LENGTH,
  X402_MAX_RAW_SCHEME_LENGTH,
  X402_MAX_RESOURCE_URL_LENGTH,
  X402_MAX_TIMEOUT_SECONDS,
} from "./payment-required.limits.js";
import { isPrototypePollutingKey } from "./payment-required.sanitize.js";
import {
  wildX402ExtraSchema,
  X402_SUPPORTED_ASSET_TRANSFER_METHOD,
  X402_SUPPORTED_SCHEMES,
  x402ExtensionsSchema,
} from "./payment-required.supported.js";

/**
 * Plain v1 network names → CAIP-2, ONLY for the names research 001 documents.
 * An unknown name is an error: guessing a chain id would sign a payment on
 * the wrong network.
 *
 * A `Map`, not an object literal, because the lookup key is attacker-authored.
 * Indexing a literal walks `Object.prototype`, and `constructor` / `__proto__`
 * both survive the caller's `.toLowerCase()` and both return non-`undefined` —
 * so `normalizeNetwork` answered `ok(<function Object>)` / `ok(Object.
 * prototype)` and pushed a NON-STRING `network`. It failed closed at the
 * trailing re-validation, but with the wrong error, and only for as long as
 * that trailing `safeParse` stayed in place. A Map has no prototype chain to
 * walk, so the failure mode is gone by construction rather than by a guard
 * someone has to remember.
 */
const V1_NETWORK_NAME_TO_CAIP2: ReadonlyMap<string, string> = new Map([
  ["base", "eip155:8453"],
  ["base-sepolia", "eip155:84532"],
]);

/**
 * Lenient parse of one wild-dialect requirement entry (v1 or v2 fields).
 * LOOSE on purpose: keys beyond the recognized dialect fields are forwarded
 * rather than stripped — see x402PaymentRequirementsSchema for why that is
 * the safe direction, for why it is NOT about byte-identity, and for why
 * loose still gets the bounded-map ceiling.
 *
 * Lenient about WHICH OPTION an entry names, too. `scheme`, `extra
 * .assetTransferMethod` and the `maxTimeoutSeconds` cap were typed here as
 * the allowlist / the literal / the bound, which made a single unsupported
 * option fail `z.array(...)` and refuse the whole payload — including a
 * sibling entry Soko could pay. Those three are now shape checks only; the
 * VALUES are refused per entry in `selectPayableRequirement`, and
 * `x402PaymentRequirementsSchema` re-imposes all three on whatever survives.
 *
 * The line is deliberate: a field of the wrong TYPE (a numeric `scheme`, a
 * fractional `maxTimeoutSeconds`) is still a payload-wide parse failure,
 * because that is a malformed 402 rather than a menu entry Soko happens not
 * to support.
 */
const wildRequirementSchema = z
  .looseObject({
    scheme: z.string().min(1).max(X402_MAX_RAW_SCHEME_LENGTH),
    network: z.string().min(1).max(X402_MAX_RAW_NETWORK_LENGTH),
    asset: z.string().min(1).max(X402_MAX_RAW_ADDRESS_LENGTH),
    // Both amount spellings stay loosely typed here: normalizeAmount owns
    // unifying them and is the single place that reports WHY an amount was
    // refused. Only the length is fenced, so neither spelling can reach an
    // error message as a megabyte string.
    amount: z.string().max(X402_MAX_RAW_AMOUNT_LENGTH).optional(),
    maxAmountRequired: z.string().max(X402_MAX_RAW_AMOUNT_LENGTH).optional(),
    payTo: z.string().min(1).max(X402_MAX_RAW_ADDRESS_LENGTH),
    maxTimeoutSeconds: z.number().int().positive(),
    extra: wildX402ExtraSchema.optional(),
    /** v1 carries the resource URL per entry, as a plain string. */
    resource: z.string().max(X402_MAX_RESOURCE_URL_LENGTH).optional(),
  })
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

export type WildX402Requirement = z.infer<typeof wildRequirementSchema>;

/** Lenient parse of a wild-dialect 402 body (either generation). */
export const wildPaymentRequiredSchema = z.object({
  x402Version: z.number().int().positive(),
  error: z.string().max(X402_MAX_ERROR_LENGTH).optional(),
  resource: z
    .union([
      z.string().max(X402_MAX_RESOURCE_URL_LENGTH),
      z.object({
        url: z.string().max(X402_MAX_RESOURCE_URL_LENGTH).optional(),
      }),
    ])
    .optional(),
  accepts: z.array(wildRequirementSchema).min(1).max(X402_MAX_ACCEPTS_ENTRIES),
  extensions: x402ExtensionsSchema.optional(),
});

function normalizeNetwork(network: string): Result<string, string> {
  const trimmed = network.trim().toLowerCase();
  if (CAIP2_EVM_NETWORK_PATTERN.test(trimmed)) {
    return ok(trimmed);
  }
  const mapped = V1_NETWORK_NAME_TO_CAIP2.get(trimmed);
  if (mapped !== undefined) {
    return ok(mapped);
  }
  return err(
    `Unknown x402 network "${truncateEcho(network)}"; expected a CAIP-2 id (eip155:*) or one of: ${[...V1_NETWORK_NAME_TO_CAIP2.keys()].join(", ")}`,
  );
}

/**
 * Canonicalizes an `asset` / `payTo` the same way every Soko-side check does
 * (`.trim().toLowerCase()`), and refuses anything that is not an ERC-20
 * address. Emitting the canonicalized value — rather than validating one
 * spelling and forwarding another — is what keeps the pre-charge check and
 * the forwarded payload talking about the same string.
 */
function normalizeEvmAddress(
  value: string,
  field: "asset" | "payTo",
): Result<string, string> {
  const normalized = value.trim().toLowerCase();
  if (!EVM_ADDRESS_PATTERN.test(normalized)) {
    return err(`Invalid x402 ${field} address: ${truncateEcho(value)}`);
  }
  return ok(normalized);
}

function normalizeAmount(entry: WildX402Requirement): Result<string, string> {
  const { amount, maxAmountRequired } = entry;
  if (
    amount !== undefined &&
    maxAmountRequired !== undefined &&
    amount !== maxAmountRequired
  ) {
    // Both spellings present but disagreeing is not a dialect — it is a
    // malformed (or manipulated) 402. Never pick one.
    return err(
      `Conflicting x402 amounts: amount=${truncateEcho(amount)}, maxAmountRequired=${truncateEcho(maxAmountRequired)}`,
    );
  }
  const value = amount ?? maxAmountRequired;
  if (value === undefined) {
    return err(
      "x402 requirement is missing an amount (neither amount nor maxAmountRequired)",
    );
  }
  if (value.length > X402_MAX_AMOUNT_DIGITS) {
    // Truncate the echo: the whole point is that the value may be enormous.
    return err(
      `x402 amount is ${value.length} digits, above the ${X402_MAX_AMOUNT_DIGITS}-digit uint256 width`,
    );
  }
  if (!/^\d+$/.test(value)) {
    return err(`Invalid x402 amount: ${truncateEcho(value)}`);
  }
  if (BigInt(value) > X402_MAX_AMOUNT_BASE_UNITS) {
    // The node persists base units in Postgres BIGINT columns, so a larger
    // demand is refused there — after the credits are charged.
    return err(
      `x402 amount ${value} exceeds the payment node's maximum of ${X402_MAX_AMOUNT_BASE_UNITS}`,
    );
  }
  return ok(value);
}

/**
 * Every key a dialect translation recognizes on a requirement entry, folded
 * to lowercase — i.e. exactly the fields destructured out of an entry before
 * the remainder is forwarded.
 */
const X402_RECOGNIZED_ENTRY_KEYS_LOWERCASE: ReadonlySet<string> = new Set([
  "scheme",
  "network",
  "asset",
  "amount",
  "maxamountrequired",
  "payto",
  "maxtimeoutseconds",
  "extra",
  "resource",
]);

/**
 * Drops any forwarded key that collides case-insensitively with a recognized
 * field once trimmed — `PayTo`, `payto`, `Amount`, `MaxTimeoutSeconds`,
 * `"payTo "`, `" payTo"`, …
 *
 * These are SHADOW keys, and the risk is forwarding, not overwriting: `PayTo`
 * and `payTo` are distinct JS keys, and the exact-case fields are
 * destructured out before the remainder is spread, so no ordering of the
 * object literal below could ever let one win. What they do is survive
 * normalization and reach the node verbatim, so a hostile 402 ships a second
 * recipient spelling alongside the registry-approved one. `/x402/pay`'s
 * `accepts` item declares no `additionalProperties: false`, so unknown keys
 * are spec-legal and only the node's parser decides which spelling it reads —
 * a fail-open dependency on a node the caller does not deploy, and exactly
 * what `narrowToChosenRequirement` exists to remove. Non-colliding unknown
 * keys (`currency`, `description`, `outputSchema`) still pass through.
 *
 * The fold is `.trim().toLowerCase()`, which does NOT cover a key padded with
 * a non-whitespace invisible such as U+200B, and `extra` is deliberately not
 * filtered at all. Neither is a diversion risk: any key the node ACTUALLY
 * reads must be a byte-exact ASCII spelling, and the node reads `extra.name` /
 * `extra.version` as an EIP-712 domain rather than as a recipient. Filtering
 * `extra` would also cut against this file's own argument — forwarding a key
 * the node ignores costs nothing, while stripping one it turns out to read
 * cannot be undone after the charge — and `extra` is a map the node does read.
 */
function dropShadowKeys(
  unknownKeys: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(unknownKeys).filter(
      ([key]) =>
        // `Object.fromEntries` DOES materialize an own `__proto__` key, so
        // this filter — not the sanitizer that already ran — is what stops
        // this rebuild from re-creating one. Belt and braces on purpose: the
        // two are independent, so neither is load-bearing alone.
        !isPrototypePollutingKey(key) &&
        // Trimmed as well as case-folded: `"payTo "` and `" payTo"` are
        // distinct JS keys that a case-only check let through. Trimming
        // decides only what COLLIDES — a non-colliding key is still emitted
        // with its whitespace intact — and a legitimate key never has any.
        !X402_RECOGNIZED_ENTRY_KEYS_LOWERCASE.has(key.trim().toLowerCase()),
    ),
  );
}

/**
 * Translates ONE offered requirement into the node's field spelling, or says
 * why that entry cannot be selected.
 *
 * An error here is about THIS entry only — the caller skips it and keeps
 * looking — so every check must be one that makes the entry unpayable on its
 * own, never one about the payload as a whole (the resource-URL pool and the
 * entry-count cap stay with the caller).
 *
 * Nothing is guessed. An unsupported scheme, transfer method, network,
 * timeout, address or amount is not translated into a supported one; the
 * entry is simply not selected, and if no entry is, the payload is refused
 * with every collected reason.
 *
 * The returned object is deliberately untyped data rather than an
 * `X402PaymentRequirements`: it has been translated, not validated, and the
 * caller's trailing `x402PaymentRequiredSchema.safeParse` is what decides
 * whether it may be emitted.
 */
export function selectPayableRequirement(
  entry: WildX402Requirement,
): Result<Record<string, unknown>, string> {
  // Exact spelling, no trim and no case fold: `Exact` is not `exact`, and a
  // scheme Soko has not seen the settlement semantics of is not one it can
  // charge credits against (see X402_SUPPORTED_SCHEMES).
  if (!X402_SUPPORTED_SCHEMES.some((supported) => supported === entry.scheme)) {
    return err(
      `Unsupported x402 scheme "${truncateEcho(entry.scheme)}"; expected one of: ${X402_SUPPORTED_SCHEMES.join(", ")}`,
    );
  }
  const assetTransferMethod = entry.extra?.assetTransferMethod;
  if (
    assetTransferMethod !== undefined &&
    assetTransferMethod !== X402_SUPPORTED_ASSET_TRANSFER_METHOD
  ) {
    return err(
      `Unsupported x402 extra.assetTransferMethod "${truncateEcho(assetTransferMethod)}"; expected ${X402_SUPPORTED_ASSET_TRANSFER_METHOD}`,
    );
  }
  if (entry.maxTimeoutSeconds > X402_MAX_TIMEOUT_SECONDS) {
    // The signed authorization is a bearer instrument until
    // `validBefore = now + maxTimeoutSeconds`, so an entry asking for a longer
    // window is refused rather than clamped — clamping would sign a payment
    // against terms the server never offered.
    return err(
      `x402 maxTimeoutSeconds ${entry.maxTimeoutSeconds} is above the ${X402_MAX_TIMEOUT_SECONDS}-second cap`,
    );
  }
  const network = normalizeNetwork(entry.network);
  if (network.isErr()) {
    return err(network.error);
  }
  const amount = normalizeAmount(entry);
  if (amount.isErr()) {
    return err(amount.error);
  }
  const asset = normalizeEvmAddress(entry.asset, "asset");
  if (asset.isErr()) {
    return err(asset.error);
  }
  const payTo = normalizeEvmAddress(entry.payTo, "payTo");
  if (payTo.isErr()) {
    return err(payTo.error);
  }
  // Split the recognized dialect fields from everything else so unknown
  // keys (live Bazaar aliases like `currency`/`recipient`) are forwarded
  // rather than stripped — see x402PaymentRequirementsSchema for why
  // forwarding is the safe direction. Only keys a dialect translation
  // consumes are dropped: `maxAmountRequired` (unified into `amount`) and
  // the v1 per-entry `resource` (hoisted by the caller).
  const {
    scheme: _scheme,
    network: _network,
    asset: _asset,
    amount: _amount,
    maxAmountRequired: _maxAmountRequired,
    payTo: _payTo,
    maxTimeoutSeconds: _maxTimeoutSeconds,
    extra: _extra,
    resource: _resource,
    ...unknownKeys
  } = entry;
  // Shadow keys are FILTERED, not merely out-ordered: see dropShadowKeys.
  // Key order here is NOT load-bearing — the recognized fields were just
  // destructured out, so nothing in the spread can collide with them, and
  // exact-case duplicates were already collapsed by JSON.parse (last
  // occurrence wins) before the wild schema validated them.
  return ok({
    ...dropShadowKeys(unknownKeys),
    scheme: entry.scheme,
    network: network.value,
    asset: asset.value,
    amount: amount.value,
    payTo: payTo.value,
    maxTimeoutSeconds: entry.maxTimeoutSeconds,
    ...(entry.extra !== undefined ? { extra: entry.extra } : {}),
  });
}
