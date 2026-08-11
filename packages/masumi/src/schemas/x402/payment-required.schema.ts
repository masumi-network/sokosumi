import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { CAIP2_EVM_NETWORK_PATTERN } from "../../utils/caip19.js";

/**
 * 402 "Payment Required" dialect normalization (PR1-SPEC §3, ticket 011 Q6).
 *
 * Two wild dialects coexist (research 001 §2):
 *
 * - **v1**: HTTP 402 with a JSON body `{ x402Version: 1, error, accepts }`
 *   where each requirement uses `maxAmountRequired` and a human network name
 *   (`"base"`, `"base-sepolia"`).
 * - **v2**: the payload moves into a base64 `PAYMENT-REQUIRED` response
 *   header: `{ x402Version: 2, error, resource, accepts, extensions }` with
 *   `amount` and CAIP-2 network ids (`eip155:8453`).
 *
 * The payment node accepts v2-shaped `accepts` entries ONLY — v1's
 * `maxAmountRequired` fails its validation. Soko therefore accepts either
 * wild dialect from the coworker (JSON object or base64 transport) and
 * normalizes to the node's shape before forwarding. Unparseable input is a
 * loud error, never a guess.
 */

/**
 * Plain v1 network names → CAIP-2, ONLY for the names research 001 documents.
 * An unknown name is an error: guessing a chain id would sign a payment on
 * the wrong network.
 */
const V1_NETWORK_NAME_TO_CAIP2: Readonly<Record<string, string>> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
};

/**
 * The upstream x402 extension key a server advertises when it supports (or
 * requires) a client-supplied payment identifier
 * (`coinbase/x402` `specs/extensions/payment_identifier.md`).
 */
export const X402_PAYMENT_IDENTIFIER_EXTENSION_KEY = "payment-identifier";

/**
 * One v2-shaped payment requirement, exactly as `POST /x402/pay` wants it.
 * Deliberately LOOSE: unknown keys pass through untouched, because the
 * chosen entry must survive byte-for-byte into the signed payload's
 * `accepted` echo (research 001 §3) — live Bazaar entries carry aliases
 * like `currency`/`recipient`, and a strict server re-402s a stripped echo
 * AFTER the charge. The node's spec has no `additionalProperties: false`,
 * so forwarding them is valid.
 */
export const x402PaymentRequirementsSchema = z.looseObject({
  scheme: z.string().min(1),
  network: z.string().regex(CAIP2_EVM_NETWORK_PATTERN),
  asset: z.string().min(1),
  /** Atomic token base units. */
  amount: z.string().regex(/^\d+$/),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

/** The node's v2 `paymentRequired` shape (`POST /x402/pay` request field). */
export const x402PaymentRequiredSchema = z.object({
  x402Version: z.number().int().positive(),
  error: z.string().optional(),
  resource: z.object({ url: z.string().optional() }).optional(),
  // The node caps `accepts` at 20 entries (`maxItems: 20`); mirroring the
  // bound here fails an oversized 402 BEFORE any credits are charged.
  accepts: z.array(x402PaymentRequirementsSchema).min(1).max(20),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type X402PaymentRequirements = z.infer<
  typeof x402PaymentRequirementsSchema
>;
export type X402PaymentRequired = z.infer<typeof x402PaymentRequiredSchema>;

/**
 * Lenient parse of one wild-dialect requirement entry (v1 or v2 fields).
 * LOOSE on purpose: every key beyond the recognized dialect fields must
 * survive normalization verbatim (see x402PaymentRequirementsSchema).
 */
const wildRequirementSchema = z.looseObject({
  scheme: z.string().min(1),
  network: z.string().min(1),
  asset: z.string().min(1),
  amount: z.string().optional(),
  maxAmountRequired: z.string().optional(),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()).optional(),
  /** v1 carries the resource URL per entry, as a plain string. */
  resource: z.string().optional(),
});

/** Lenient parse of a wild-dialect 402 body (either generation). */
const wildPaymentRequiredSchema = z.object({
  x402Version: z.number().int().positive(),
  error: z.string().optional(),
  resource: z
    .union([z.string(), z.object({ url: z.string().optional() })])
    .optional(),
  accepts: z.array(wildRequirementSchema).min(1).max(20),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

function normalizeNetwork(network: string): Result<string, string> {
  const trimmed = network.trim().toLowerCase();
  if (CAIP2_EVM_NETWORK_PATTERN.test(trimmed)) {
    return ok(trimmed);
  }
  const mapped = V1_NETWORK_NAME_TO_CAIP2[trimmed];
  if (mapped !== undefined) {
    return ok(mapped);
  }
  return err(
    `Unknown x402 network "${network}"; expected a CAIP-2 id (eip155:*) or one of: ${Object.keys(V1_NETWORK_NAME_TO_CAIP2).join(", ")}`,
  );
}

function normalizeAmount(
  entry: z.infer<typeof wildRequirementSchema>,
): Result<string, string> {
  const { amount, maxAmountRequired } = entry;
  if (
    amount !== undefined &&
    maxAmountRequired !== undefined &&
    amount !== maxAmountRequired
  ) {
    // Both spellings present but disagreeing is not a dialect — it is a
    // malformed (or manipulated) 402. Never pick one.
    return err(
      `Conflicting x402 amounts: amount=${amount}, maxAmountRequired=${maxAmountRequired}`,
    );
  }
  const value = amount ?? maxAmountRequired;
  if (value === undefined) {
    return err(
      "x402 requirement is missing an amount (neither amount nor maxAmountRequired)",
    );
  }
  if (!/^\d+$/.test(value)) {
    return err(`Invalid x402 amount: ${value}`);
  }
  return ok(value);
}

function decodeBase64PaymentRequired(value: string): Result<unknown, string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err("Empty x402 payment-required payload");
  }
  // Buffer.from(..., "base64") never throws — it skips invalid characters
  // and decodes best-effort — so non-base64 garbage surfaces as unparseable
  // JSON below.
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  try {
    return ok(JSON.parse(decoded) as unknown);
  } catch {
    return err(
      "x402 payment-required header is not base64-encoded JSON (expected the base64 PAYMENT-REQUIRED transport)",
    );
  }
}

/**
 * Normalizes either wild 402 dialect to the node's v2 `paymentRequired`
 * shape. Accepts a parsed JSON body (v1 or v2) or the base64 string of the
 * v2 `PAYMENT-REQUIRED` header transport. Fails loud on anything else.
 */
export function normalizeX402PaymentRequired(
  input: unknown,
): Result<X402PaymentRequired, string> {
  let candidate: unknown = input;
  if (typeof candidate === "string") {
    const decoded = decodeBase64PaymentRequired(candidate);
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    candidate = decoded.value;
  }

  const wild = wildPaymentRequiredSchema.safeParse(candidate);
  if (!wild.success) {
    return err(`Unparseable x402 402 payload: ${z.prettifyError(wild.error)}`);
  }

  const accepts: X402PaymentRequirements[] = [];
  for (const entry of wild.data.accepts) {
    const network = normalizeNetwork(entry.network);
    if (network.isErr()) {
      return err(network.error);
    }
    const amount = normalizeAmount(entry);
    if (amount.isErr()) {
      return err(amount.error);
    }
    // Split the recognized dialect fields from everything else so unknown
    // keys (live Bazaar aliases like `currency`/`recipient`) pass through
    // VERBATIM — the chosen entry must survive byte-for-byte into the
    // signed payload's `accepted` echo (research 001 §3); a strict server
    // re-402s a stripped echo AFTER the charge. Only keys a dialect
    // translation consumes are dropped: `maxAmountRequired` (unified into
    // `amount`) and the v1 per-entry `resource` (hoisted below).
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
    accepts.push({
      ...unknownKeys,
      scheme: entry.scheme,
      network: network.value,
      asset: entry.asset,
      amount: amount.value,
      payTo: entry.payTo,
      maxTimeoutSeconds: entry.maxTimeoutSeconds,
      ...(entry.extra !== undefined ? { extra: entry.extra } : {}),
    });
  }

  // v2 carries the resource as a top-level object; v1 as a per-entry string.
  // Entries naming DIFFERENT resources is not a dialect — it is a malformed
  // (or manipulated) 402. Never pick one (same stance as the
  // conflicting-amounts guard).
  const entryResources = Array.from(
    new Set(
      wild.data.accepts
        .map((entry) => entry.resource)
        .filter((value): value is string => value !== undefined),
    ),
  );
  if (entryResources.length > 1) {
    return err(
      `Conflicting x402 per-entry resource URLs: ${entryResources.join(", ")}`,
    );
  }
  const resourceUrl =
    typeof wild.data.resource === "object"
      ? wild.data.resource.url
      : (wild.data.resource ?? entryResources[0]);

  const normalized: X402PaymentRequired = {
    x402Version: wild.data.x402Version,
    accepts,
    ...(wild.data.error !== undefined ? { error: wild.data.error } : {}),
    ...(resourceUrl !== undefined ? { resource: { url: resourceUrl } } : {}),
    ...(wild.data.extensions !== undefined
      ? { extensions: wild.data.extensions }
      : {}),
  };

  const validated = x402PaymentRequiredSchema.safeParse(normalized);
  if (!validated.success) {
    return err(
      `Normalized x402 payload failed validation: ${z.prettifyError(validated.error)}`,
    );
  }
  return ok(validated.data);
}

/**
 * Whether the 402 advertises the payment-identifier extension. The node
 * 400s a `paymentIdentifier` sent against a 402 that does not advertise it
 * (ticket 011 Q2), so the pay route must gate on this before stamping task
 * identity into the request.
 */
export function isX402PaymentIdentifierAdvertised(
  paymentRequired: Pick<X402PaymentRequired, "extensions">,
): boolean {
  const extension =
    paymentRequired.extensions?.[X402_PAYMENT_IDENTIFIER_EXTENSION_KEY];
  return typeof extension === "object" && extension !== null;
}
