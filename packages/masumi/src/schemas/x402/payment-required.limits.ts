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
 * Upper bound on the RAW `scheme` string a wild 402 may carry.
 *
 * The wild reader can no longer type `scheme` as the allowlist — one
 * unsupported option must cost only its own entry, not the whole 402 — so the
 * field arrives as a free string that reaches an error message. Every scheme
 * the spec repo defines is under 20 characters (`batch-settlement` is the
 * longest), so this rejects nothing legitimate and only stops a multi-megabyte
 * string from being echoed.
 */
export const X402_MAX_RAW_SCHEME_LENGTH = 64;

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
 *
 * The same ceiling is applied to the WILD entry before translation and to the
 * EMITTED entry after it, and translation can GROW an entry: a v1 network name
 * expands to CAIP-2 (`base` → `eip155:8453`, +7 characters). So a 7-character
 * window exists where an entry passes the wild check and its emitted form does
 * not — measured: a `base` entry serializing to 8186–8192 characters parses,
 * then fails the trailing `x402PaymentRequiredSchema.safeParse`, which refuses
 * the whole payload including any payable sibling. Documented rather than
 * special-cased: it fails CLOSED, it is identical to the pre-selection
 * behaviour, only the resource server can author it, and an 8 KiB entry is
 * orders of magnitude past any live listing. Raising the emitted ceiling above
 * the wild one is the fix if a real 402 ever comes near.
 */
export const X402_MAX_SERIALIZED_LENGTH = 8192;
/**
 * Longest base64 `PAYMENT-REQUIRED` header this module will decode.
 *
 * The one real asymmetry between the two dialects: a JSON body inherits
 * whatever limit the route sets on the request body, while the header dialect
 * decoded and `JSON.parse`d with no bound from here at all. Measured: a
 * 66 667 028-character header decoded to ~50 MB and was parsed before any cap
 * could apply — rejected in 48 ms, but at full peak allocation, and the
 * resource server picks the size.
 *
 * THIS BOUND COVERS THE BASE64 HEADER ONLY. Its companion for the v1
 * JSON-body dialect is the Hono `bodyLimit` on the pay route,
 * `POST /v1/tasks/{id}/x402-payments` in `apps/core` — nothing in this package
 * bounds a parsed body's total size, and `stripPrototypePollutingKeys` walks
 * one in full before any per-field cap in this file applies (measured: a
 * 32 MB body costs ~32 ms and ~9.4 MB of heap). The two are one pair: raising
 * or removing either without the other reopens the asymmetry this constant
 * exists to close.
 *
 * 256 KiB rejects nothing the rest of this file would accept. The largest
 * payload every other bound permits is `X402_MAX_ACCEPTS_ENTRIES` (20) x
 * `X402_MAX_SERIALIZED_LENGTH` (8192) = 160 KiB of entries, plus a bounded
 * `extensions` map, `error` and `resource` — about 172 KiB of JSON, which
 * base64 inflates by 4/3 to roughly 229 KiB. It is also far above any real
 * HTTP header, which servers commonly cap around 8–16 KiB.
 */
export const X402_MAX_ENCODED_PAYLOAD_LENGTH = 262_144;

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
 * Longest DETAIL a rejection message may carry — a whole `z.prettifyError`
 * dump, or a whole list of pooled resource URLs, rather than one field.
 *
 * `X402_MAX_ECHOED_VALUE_LENGTH` bounds one attacker-controlled VALUE, which
 * left the two echoes that are built out of many of them unbounded. Measured:
 * a 20-entry payload with every field wrong-typed produced 13 739 characters
 * of `z.prettifyError` output, and 20 disagreeing resource URLs produced
 * 1 890 — 13× and 2× the `X402_MAX_ERROR_LENGTH` this same file imposes on
 * the 402's OWN `error` blurb, in a string that lands in the response body,
 * the logs and Sentry on every rejected 402.
 *
 * 896 is `X402_MAX_ERROR_LENGTH` minus 128 characters of headroom for the
 * fixed prefix each caller prepends (the longest is "No payable x402
 * requirement in accepts (20 refused): ", 53 characters). The point of the
 * headroom is the invariant it buys: EVERY rejection message this module
 * produces fits the same 1024 characters a 402 is allowed to spend on its own
 * error.
 */
export const X402_MAX_DETAIL_LENGTH = X402_MAX_ERROR_LENGTH - 128;

/**
 * Shortens a composed error DETAIL — zod's prettified issue list, a joined
 * URL pool — to `X402_MAX_DETAIL_LENGTH`, suffix included, naming the true
 * length instead of repeating it.
 *
 * Distinct from `truncateEcho`, which bounds a single field: applying an
 * 78-character cap to an issue list would throw away the first issue's
 * message, and applying no cap at all is what produced the 13 739-character
 * error. Same code-point-boundary rule, for the same reason.
 */
export function truncateDetail(detail: string): string {
  if (detail.length <= X402_MAX_DETAIL_LENGTH) {
    return detail;
  }
  const suffix = `… (${detail.length} chars)`;
  return `${sliceWholeCodePoints(detail, X402_MAX_DETAIL_LENGTH - suffix.length)}${suffix}`;
}

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
