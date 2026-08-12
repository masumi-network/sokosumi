/**
 * Hostile-input bounds for the 402 "Payment Required" payload, and the two
 * guards built on them.
 *
 * Every value in a 402 is attacker-authored: the coworker hands Soko whatever
 * the resource server replied with, and Soko forwards a normalized version of
 * it to the payment node while charging credits against it. These constants
 * are the one place that decides how much of that data may pass, how large it
 * may be, and how much of it may be repeated back in an error — separated
 * from the shapes in `payment-required.schema.ts` because they answer a
 * different question (how much, not what).
 *
 * Every bound is set to the tightest value that rejects nothing legitimate:
 * see each constant for the live-listing evidence behind it.
 */

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
 * `accepts` entries allowed in one 402. The node caps its own
 * `paymentRequired.accepts` at 20 (`maxItems: 20`); mirroring the bound fails
 * an oversized 402 BEFORE any credits are charged.
 */
export const X402_MAX_ACCEPTS_ENTRIES = 20;

/**
 * Upper bound on the RAW `asset` / `payTo` string a wild 402 may carry,
 * before trimming. 42 characters plus room for surrounding whitespace — the
 * value is address-validated straight after, so this only stops a
 * multi-megabyte string from reaching the regex.
 */
export const X402_MAX_RAW_ADDRESS_LENGTH = 64;

/** uint256 in decimal is at most 78 digits — a cheap structural bound. */
export const X402_MAX_AMOUNT_DIGITS = 78;

/**
 * The largest amount the payment node can persist: its attempt/budget rows
 * store base units in Postgres `BIGINT` columns (2^63−1). A larger demand is
 * refused node-side AFTER Soko has charged credits, so it is bounded here
 * instead.
 */
export const X402_MAX_AMOUNT_BASE_UNITS = 9223372036854775807n;

/**
 * Upper bound on the RAW `network` string a wild 402 may carry. A CAIP-2 id
 * caps its namespace at 8 and its reference at 32 characters (41 with the
 * separator) and the v1 plain names are shorter still, so this rejects
 * nothing legitimate — it stops a multi-megabyte string reaching the regex
 * and, before that, the error message that echoes it.
 */
export const X402_MAX_RAW_NETWORK_LENGTH = 64;

/**
 * Upper bound on the RAW `amount` / `maxAmountRequired` strings. Wide enough
 * that `normalizeAmount` can still report the exact digit width of a
 * plausibly-mistaken amount (uint256 is 78 digits), narrow enough that the
 * conflicting-amounts echo cannot be built out of two megabyte strings.
 */
export const X402_MAX_RAW_AMOUNT_LENGTH = 256;

/** The 402's human-readable error blurb; logged, never parsed. */
export const X402_MAX_ERROR_LENGTH = 1024;
/** Practical URL ceiling, matching the common 2048-char limit. */
export const X402_MAX_RESOURCE_URL_LENGTH = 2048;
/** Entries allowed in a free-form `extensions` / `extra` map. */
export const X402_MAX_MAP_ENTRIES = 32;
/** Key length allowed in a free-form `extensions` / `extra` map. */
export const X402_MAX_MAP_KEY_LENGTH = 128;
/**
 * Serialized-size ceiling on a bounded map AND on a whole requirement entry.
 *
 * Key counts alone left every VALUE unbounded: a single `extra.blob` of 1 MB
 * passed, and so did a 1 MB unknown key on the entry. 8 KiB is far above any
 * live listing — the largest field a Bazaar entry carries is `outputSchema`,
 * a small JSON schema — and it caps the whole forwarded 402 at 20 entries ×
 * 8 KiB.
 */
export const X402_MAX_SERIALIZED_LENGTH = 8192;
/** `extra.name` / `extra.version` — an EIP-712 domain, never long. */
export const X402_MAX_EIP712_DOMAIN_VALUE_LENGTH = 128;

/**
 * Deepest nesting a 402 value may have, for the two walks that recurse over
 * it: the prototype-key sanitizer and the canonical-JSON comparison.
 *
 * A recursive walk over attacker-authored data needs a depth bound, or a
 * `{"a":{"a":{"a":…` payload becomes a `RangeError` thrown out of a function
 * whose contract is that it only ever returns. The size caps do not supply
 * one on their own: they are applied by the schema, i.e. AFTER the sanitizer
 * has already had to walk the value.
 *
 * 64 rejects nothing legitimate. The deepest field a live 402 carries is an
 * `outputSchema` JSON schema, a handful of levels at most, and no other field
 * nests at all.
 */
export const X402_MAX_JSON_DEPTH = 64;

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
export const X402_MAX_ECHOED_VALUE_LENGTH = 78;

/**
 * Shortens an attacker-controlled value for an error message, naming the true
 * length instead of repeating it. Same stance as the digit-width rejection in
 * `normalizeAmount`: the whole point is that the value may be enormous.
 */
export function truncateEcho(value: string): string {
  if (value.length <= X402_MAX_ECHOED_VALUE_LENGTH) {
    return value;
  }
  return `${sliceWholeCodePoints(value, X402_MAX_ECHOED_VALUE_LENGTH)}… (${value.length} chars)`;
}

/**
 * `String.prototype.slice` counts UTF-16 code units, so a cap at an odd offset
 * cuts an astral character in half and leaves a LONE HIGH SURROGATE at the
 * end — `truncateEcho("a" + "😀".repeat(60))` did exactly that.
 *
 * ES2019 `JSON.stringify` escapes a lone surrogate, so a JSON response body
 * survives it; a `Buffer`/Postgres write silently substitutes U+FFFD and some
 * log shippers reject the value outright. Since an echo exists to be read by
 * an operator in exactly those places, the cut goes to the nearest whole code
 * point instead — which costs at most one code unit.
 */
function sliceWholeCodePoints(value: string, maxLength: number): string {
  const lastUnit = value.charCodeAt(maxLength - 1);
  const splitsAPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
  return value.slice(0, splitsAPair ? maxLength - 1 : maxLength);
}

/**
 * A free-form attacker-controlled map — `extensions`, the unknown keys of
 * `extra`, and a requirement entry itself, which is the same surface by
 * another name. Bounded in entry count, key length AND serialized size, so a
 * 402 cannot ship an unbounded blob into the node's request body.
 */
export function boundedMapCheck(value: Record<string, unknown>): boolean {
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

export const BOUNDED_MAP_MESSAGE = `Too many entries, too long a key, or too large serialized (max ${X402_MAX_MAP_ENTRIES} entries, ${X402_MAX_MAP_KEY_LENGTH}-char keys, ${X402_MAX_SERIALIZED_LENGTH} serialized characters)`;
