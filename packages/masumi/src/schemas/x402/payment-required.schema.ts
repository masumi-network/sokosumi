import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "../../utils/caip19.js";

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
 * Hard ceiling on an entry's `maxTimeoutSeconds`.
 *
 * `maxTimeoutSeconds` is the ONLY input to the signed authorization's expiry:
 * the x402 exact-EVM client signs `validAfter = now − 600 s` and
 * `validBefore = now + maxTimeoutSeconds` (research 001 §4, verified against
 * `coinbase/x402` `schemes/exact/evm/client.ts`). The `X-PAYMENT` header the
 * node hands back is a BEARER instrument until `validBefore`: whoever holds
 * it can settle it against Soko's managed wallet. zod's `.int()` only bounds
 * to the safe-integer range, so an unbounded field lets an attacker-authored
 * 402 mint an authorization valid for ~285 million years — collected, never
 * settled, and settleable forever, with no expiry for a reconciler to wait
 * on.
 *
 * 3600 s is the tightest cap that rejects nothing legitimate: research 001 §2
 * records 60–3600 s across live Bazaar listings. It is far below the 86400 s
 * ceiling the payment node itself declares on the inbound
 * `paymentPayload.accepted.maxTimeoutSeconds`
 * (`packages/masumi/spec/payment.openapi.json`), which is the only
 * node-declared bound that exists — the buy-side `/x402/pay`
 * `paymentRequired.accepts` item declares no maximum at all.
 */
export const X402_MAX_TIMEOUT_SECONDS = 3600;

/**
 * The `asset` / `payTo` spelling the normalizer EMITS: an ERC-20 address,
 * canonically lowercase.
 *
 * Every Soko-side check canonicalizes with `.trim().toLowerCase()` before
 * comparing (`buildCaip19AssetKey`, `findX402ReadySource`,
 * `verifyX402DemandAgainstAgentSources`), so the forwarded entry must carry
 * the value those checks compared — otherwise Soko validates one string and
 * forwards a different one, and the future `payTo`-vs-registry comparison
 * inherits the split. Case folding cannot turn one address into another, so
 * this is a fail-fast/consistency fence, not a diversion fix: an unvalidated
 * address would simply fail at the node AFTER the credits were charged.
 */
const CANONICAL_EVM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

/**
 * Upper bound on the RAW `asset` / `payTo` string a wild 402 may carry,
 * before trimming. 42 characters plus room for surrounding whitespace — the
 * value is address-validated straight after, so this only stops a
 * multi-megabyte string from reaching the regex.
 */
const X402_MAX_RAW_ADDRESS_LENGTH = 64;

/**
 * The ONLY `extra.assetTransferMethod` Soko forwards.
 *
 * In x402 v2 exact-EVM the field selects the signing primitive the wallet
 * uses (`eip3009`, `permit2`, `erc7710`), so leaving it unvalidated lets
 * attacker-authored data pick how Soko's managed wallet signs. Independently
 * of what the node does with it, Soko's own settlement bookkeeping
 * (`extractEip3009Authorization`, apps/core) reads an EIP-3009
 * `{ nonce, validBefore }` authorization out of the signed payload, so any
 * other method silently empties the phased-settlement records the future
 * expiry reconciler depends on. Anything else is refused pre-charge.
 *
 * Exact spelling only: the field appears nowhere in the pinned node spec
 * (`packages/masumi/spec/payment.openapi.json` types `extra` as a free-form
 * `additionalProperties` map), so no live 402 in scope sends it at all and
 * strictness costs nothing today.
 */
export const X402_SUPPORTED_ASSET_TRANSFER_METHOD = "eip3009";

/** uint256 in decimal is at most 78 digits — a cheap structural bound. */
const X402_MAX_AMOUNT_DIGITS = 78;

/**
 * The largest amount the payment node can persist: its attempt/budget rows
 * store base units in Postgres `BIGINT` columns (2^63−1). A larger demand is
 * refused node-side AFTER Soko has charged credits, so it is bounded here
 * instead.
 */
const X402_MAX_AMOUNT_BASE_UNITS = 9223372036854775807n;

/**
 * Upper bound on the RAW `network` string a wild 402 may carry. A CAIP-2 id
 * caps its namespace at 8 and its reference at 32 characters (41 with the
 * separator) and the v1 plain names are shorter still, so this rejects
 * nothing legitimate — it stops a multi-megabyte string reaching the regex
 * and, before that, the error message that echoes it.
 */
const X402_MAX_RAW_NETWORK_LENGTH = 64;

/**
 * Upper bound on the RAW `amount` / `maxAmountRequired` strings. Wide enough
 * that `normalizeAmount` can still report the exact digit width of a
 * plausibly-mistaken amount (uint256 is 78 digits), narrow enough that the
 * conflicting-amounts echo cannot be built out of two megabyte strings.
 */
const X402_MAX_RAW_AMOUNT_LENGTH = 256;

/** `exact`, `upto`, `batch-settlement` — no real scheme name is near this. */
const X402_MAX_SCHEME_LENGTH = 32;
/** The 402's human-readable error blurb; logged, never parsed. */
const X402_MAX_ERROR_LENGTH = 1024;
/** Practical URL ceiling, matching the common 2048-char limit. */
const X402_MAX_RESOURCE_URL_LENGTH = 2048;
/** Entries allowed in a free-form `extensions` / `extra` map. */
const X402_MAX_MAP_ENTRIES = 32;
/** Key length allowed in a free-form `extensions` / `extra` map. */
const X402_MAX_MAP_KEY_LENGTH = 128;
/**
 * Serialized-size ceiling on a bounded map AND on a whole requirement entry.
 *
 * Key counts alone left every VALUE unbounded: a single `extra.blob` of 1 MB
 * passed, and so did a 1 MB unknown key on the entry. 8 KiB is far above any
 * live listing — the largest field a Bazaar entry carries is `outputSchema`,
 * a small JSON schema — and it caps the whole forwarded 402 at 20 entries ×
 * 8 KiB.
 */
const X402_MAX_SERIALIZED_LENGTH = 8192;
/** `extra.name` / `extra.version` — an EIP-712 domain, never long. */
const X402_MAX_EIP712_DOMAIN_VALUE_LENGTH = 128;

/**
 * Longest attacker-controlled value any error message repeats back. 78 is a
 * full-width uint256 amount — the widest value worth reading in full.
 *
 * Every rejection echo is built once per `accepts` entry (up to 20) and ends
 * up in the response body, the logs and Sentry, so an echo is only ever as
 * bounded as the field it repeats. The schema caps above are the first fence;
 * this is the second, so loosening a cap later cannot silently reopen the
 * multi-megabyte error string.
 */
const X402_MAX_ECHOED_VALUE_LENGTH = 78;

/**
 * Shortens an attacker-controlled value for an error message, naming the true
 * length instead of repeating it. Same stance as the digit-width rejection in
 * `normalizeAmount`: the whole point is that the value may be enormous.
 */
function truncateEcho(value: string): string {
  if (value.length <= X402_MAX_ECHOED_VALUE_LENGTH) {
    return value;
  }
  return `${value.slice(0, X402_MAX_ECHOED_VALUE_LENGTH)}… (${value.length} chars)`;
}

/**
 * A free-form attacker-controlled map — `extensions`, the unknown keys of
 * `extra`, and a requirement entry itself, which is the same surface by
 * another name. Bounded in entry count, key length AND serialized size, so a
 * 402 cannot ship an unbounded blob into the node's request body.
 */
function boundedMapCheck(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (
    keys.length > X402_MAX_MAP_ENTRIES ||
    keys.some((key) => key.length > X402_MAX_MAP_KEY_LENGTH)
  ) {
    return false;
  }
  // JSON.stringify is the serialization the payload reaches the node through,
  // so it is the size that matters. It can throw on a hand-built object (a
  // BigInt value, a cycle) even though one from JSON.parse never contains
  // either, and a check must never throw out of `safeParse` — so a value that
  // cannot be serialized fails closed.
  try {
    return (JSON.stringify(value)?.length ?? 0) <= X402_MAX_SERIALIZED_LENGTH;
  } catch {
    return false;
  }
}

const BOUNDED_MAP_MESSAGE = `Too many entries, too long a key, or too large serialized (max ${X402_MAX_MAP_ENTRIES} entries, ${X402_MAX_MAP_KEY_LENGTH}-char keys, ${X402_MAX_SERIALIZED_LENGTH} serialized characters)`;

const x402ExtensionsSchema = z
  .record(z.string(), z.unknown())
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

/**
 * `extra` stays LOOSE — it carries the EIP-712 domain (`name`, `version`) for
 * the signature plus scheme-specific keys (`batch-settlement` adds
 * `receiverAuthorizer`/`withdrawDelay`) — but the three keys that change how
 * the wallet signs are typed, and the transfer method is pinned.
 */
const x402ExtraSchema = z
  .looseObject({
    name: z.string().max(X402_MAX_EIP712_DOMAIN_VALUE_LENGTH).optional(),
    version: z.string().max(X402_MAX_EIP712_DOMAIN_VALUE_LENGTH).optional(),
    assetTransferMethod: z
      .literal(X402_SUPPORTED_ASSET_TRANSFER_METHOD)
      .optional(),
  })
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

/**
 * Atomic token base units, bounded both structurally (digit width) and
 * numerically (what the node can persist), so an absurd amount is a
 * pre-charge rejection rather than a post-charge node error.
 *
 * Both structural checks ABORT. zod 4 keeps running later checks on the same
 * schema after an earlier one fails, so without this the `BigInt(value)` in
 * the refine ran on values the regex had already rejected and threw a
 * `SyntaxError` straight out of `safeParse` — turning a 422 into an unhandled
 * 500 for any caller that validates a stored or untrusted payload with the
 * exported schema. Aborting on width also makes `.max()` mean something: a
 * 10 000 000-digit string is refused on length instead of getting a full
 * (quadratic) BigInt conversion first.
 */
const x402AmountSchema = z
  .string()
  .regex(/^\d+$/, { abort: true })
  .max(X402_MAX_AMOUNT_DIGITS, { abort: true })
  .refine((value) => BigInt(value) <= X402_MAX_AMOUNT_BASE_UNITS, {
    message: `Amount exceeds the payment node's maximum of ${X402_MAX_AMOUNT_BASE_UNITS}`,
  });

/**
 * One v2-shaped payment requirement, exactly as `POST /x402/pay` wants it.
 *
 * Deliberately LOOSE — unknown keys pass through untouched — but NOT for the
 * reason this comment used to give. It claimed the chosen entry survives
 * "byte-for-byte" into the signed payload's `accepted` echo. It does not, on
 * two counts:
 *
 * - Normalization itself breaks byte-identity: it rewrites `network` (v1
 *   name → CAIP-2, shouty → lowercase), canonicalizes `asset`/`payTo`, and
 *   drops the v1 per-entry `resource`.
 * - The node's own model of the echo has no room for extra keys. Its
 *   `paymentPayload.accepted` shape (`packages/masumi/spec/payment.openapi.json`,
 *   `/x402/verify` and `/x402/settle`) enumerates exactly `scheme`,
 *   `network`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds` and `extra` —
 *   `currency`/`recipient`/`description`/`mimeType`/`outputSchema` have
 *   nowhere to land, and the node's buy-side request parser strips them.
 *
 * What the looseness actually buys is the only asymmetry that matters:
 * forwarding an ignored key costs nothing, while stripping a key the node
 * turns out to propagate cannot be undone AFTER the credits are charged and
 * a settleable header exists (a strict resource server re-402s, and the
 * bearer authorization is still spendable). Unknown keys are never read by
 * Soko, never reach a signing input, and the node validates its own shape, so
 * the safe direction is to pass them on.
 *
 * Loose is NOT unbounded, and the previous comment's "the extra surface is
 * bounded" was wishful: nothing capped the entry at all until
 * `boundedMapCheck` was applied here. It is the same free-form
 * attacker-controlled map as `extensions`/`extra`, so it gets the same entry
 * count, key length and serialized size ceiling. Keys that collide
 * case-insensitively with a validated field are dropped in the normalization
 * loop (see `dropShadowKeys`).
 */
export const x402PaymentRequirementsSchema = z
  .looseObject({
    scheme: z.string().min(1).max(X402_MAX_SCHEME_LENGTH),
    network: z.string().regex(CAIP2_EVM_NETWORK_PATTERN),
    asset: z.string().regex(CANONICAL_EVM_ADDRESS_PATTERN),
    /** Atomic token base units. */
    amount: x402AmountSchema,
    payTo: z.string().regex(CANONICAL_EVM_ADDRESS_PATTERN),
    maxTimeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(X402_MAX_TIMEOUT_SECONDS),
    extra: x402ExtraSchema.optional(),
  })
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

/** The node's v2 `paymentRequired` shape (`POST /x402/pay` request field). */
export const x402PaymentRequiredSchema = z.object({
  x402Version: z.number().int().positive(),
  error: z.string().max(X402_MAX_ERROR_LENGTH).optional(),
  resource: z
    .object({ url: z.string().max(X402_MAX_RESOURCE_URL_LENGTH).optional() })
    .optional(),
  // The node caps `accepts` at 20 entries (`maxItems: 20`); mirroring the
  // bound here fails an oversized 402 BEFORE any credits are charged.
  accepts: z.array(x402PaymentRequirementsSchema).min(1).max(20),
  extensions: x402ExtensionsSchema.optional(),
});

export type X402PaymentRequirements = z.infer<
  typeof x402PaymentRequirementsSchema
>;
export type X402PaymentRequired = z.infer<typeof x402PaymentRequiredSchema>;

/**
 * Lenient parse of one wild-dialect requirement entry (v1 or v2 fields).
 * LOOSE on purpose: keys beyond the recognized dialect fields are forwarded
 * rather than stripped — see x402PaymentRequirementsSchema for why that is
 * the safe direction, for why it is NOT about byte-identity, and for why
 * loose still gets the bounded-map ceiling.
 */
const wildRequirementSchema = z
  .looseObject({
    scheme: z.string().min(1).max(X402_MAX_SCHEME_LENGTH),
    network: z.string().min(1).max(X402_MAX_RAW_NETWORK_LENGTH),
    asset: z.string().min(1).max(X402_MAX_RAW_ADDRESS_LENGTH),
    // Both amount spellings stay loosely typed here: normalizeAmount owns
    // unifying them and is the single place that reports WHY an amount was
    // refused. Only the length is fenced, so neither spelling can reach an
    // error message as a megabyte string.
    amount: z.string().max(X402_MAX_RAW_AMOUNT_LENGTH).optional(),
    maxAmountRequired: z.string().max(X402_MAX_RAW_AMOUNT_LENGTH).optional(),
    payTo: z.string().min(1).max(X402_MAX_RAW_ADDRESS_LENGTH),
    maxTimeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(X402_MAX_TIMEOUT_SECONDS),
    extra: x402ExtraSchema.optional(),
    /** v1 carries the resource URL per entry, as a plain string. */
    resource: z.string().max(X402_MAX_RESOURCE_URL_LENGTH).optional(),
  })
  .refine(boundedMapCheck, { message: BOUNDED_MAP_MESSAGE });

/** Lenient parse of a wild-dialect 402 body (either generation). */
const wildPaymentRequiredSchema = z.object({
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
  accepts: z.array(wildRequirementSchema).min(1).max(20),
  extensions: x402ExtensionsSchema.optional(),
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
    `Unknown x402 network "${truncateEcho(network)}"; expected a CAIP-2 id (eip155:*) or one of: ${Object.keys(V1_NETWORK_NAME_TO_CAIP2).join(", ")}`,
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
 * field — `PayTo`, `payto`, `Amount`, `MaxTimeoutSeconds`, …
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
 */
function dropShadowKeys(
  unknownKeys: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(unknownKeys).filter(
      ([key]) => !X402_RECOGNIZED_ENTRY_KEYS_LOWERCASE.has(key.toLowerCase()),
    ),
  );
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
    // the v1 per-entry `resource` (hoisted below).
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
    accepts.push({
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

  // v2 carries the resource as a top-level object; v1 as a per-entry string.
  // A 402 naming DIFFERENT resources is not a dialect — it is a malformed
  // (or manipulated) 402. Never pick one (same stance as the
  // conflicting-amounts guard). ALL resource sources are pooled — the
  // top-level object AND every per-entry string — so a top-level url that
  // disagrees with a per-entry one is caught too, not silently preferred.
  const topLevelResource =
    typeof wild.data.resource === "object"
      ? wild.data.resource.url
      : wild.data.resource;
  const resources = Array.from(
    new Set(
      [
        topLevelResource,
        ...wild.data.accepts.map((entry) => entry.resource),
      ].filter((value): value is string => value !== undefined),
    ),
  );
  if (resources.length > 1) {
    // Up to 21 pooled URLs at 2048 characters each, so the echo is truncated
    // per URL for the same reason the network and amount echoes are.
    return err(
      `Conflicting x402 resource URLs: ${resources.map(truncateEcho).join(", ")}`,
    );
  }
  const resourceUrl = resources[0];

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
 * Rebuilds the forwarded 402 with a SINGLE `accepts` entry — the one Soko
 * verified against the agent's registered payment sources.
 *
 * Fund-diversion defence in depth, not a live-exploit fix. `POST /x402/pay`
 * receives the whole `paymentRequired` payload and the NODE decides which
 * entry it signs; nothing node-side constrains `payTo`. Two Soko-side fences
 * already narrow that: `verifyX402DemandAgainstAgentSources` refuses a 402
 * whose same-`(network, asset)` entries disagree on `payTo`/`amount`, and the
 * pay call sends `preferredNetwork` + `preferredAsset`. The residual gap is
 * an entry for a DIFFERENT asset on the same chain: it never meets the
 * same-pair fence, so it is filtered only if the node honours
 * `preferredAsset` — a fail-open-on-version-skew dependency on a node the
 * caller does not deploy. Handing the node one entry makes its selection rule
 * irrelevant.
 *
 * NOT dead code: the pay route lives on branch `x402-5-pay` and is wired to
 * this helper there (it must call it with the entry
 * `verifyX402DemandAgainstAgentSources` returned). It ships here because the
 * schema owns the payload shape.
 *
 * Pure: the input payload is not mutated.
 */
export function narrowToChosenRequirement(
  paymentRequired: X402PaymentRequired,
  chosen: X402PaymentRequirements,
): X402PaymentRequired {
  return { ...paymentRequired, accepts: [chosen] };
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
  // `typeof [] === "object"`, so an array must be excluded explicitly — the
  // upstream extension is an object (`{ info: { required } , schema }`), and
  // reading an array as "advertised" would stamp a paymentIdentifier the
  // server never advertised, which the node answers with a 400.
  return (
    typeof extension === "object" &&
    extension !== null &&
    !Array.isArray(extension)
  );
}
