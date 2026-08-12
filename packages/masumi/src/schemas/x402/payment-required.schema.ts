import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { CAIP2_EVM_NETWORK_PATTERN } from "../../utils/caip19.js";
import { canonicalJsonKey } from "./payment-required.canonical.js";
import {
  BOUNDED_MAP_MESSAGE,
  boundedMapCheck,
  truncateDetail,
  truncateEcho,
  X402_MAX_ACCEPTS_ENTRIES,
  X402_MAX_AMOUNT_BASE_UNITS,
  X402_MAX_AMOUNT_DIGITS,
  X402_MAX_ENCODED_PAYLOAD_LENGTH,
  X402_MAX_ERROR_LENGTH,
  X402_MAX_RESOURCE_URL_LENGTH,
  X402_MAX_TIMEOUT_SECONDS,
} from "./payment-required.limits.js";
import { stripPrototypePollutingKeys } from "./payment-required.sanitize.js";
import {
  X402_SUPPORTED_SCHEMES,
  x402ExtensionsSchema,
  x402ExtraSchema,
} from "./payment-required.supported.js";
import {
  selectPayableRequirement,
  wildPaymentRequiredSchema,
} from "./payment-required.wild.js";

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
 *
 * The wild dialect shapes and the per-entry translation live in
 * `payment-required.wild.ts`; this file owns what Soko may EMIT.
 */

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
 * case-insensitively with a validated field are dropped while the entry is
 * translated (see `dropShadowKeys` in `payment-required.wild.ts`).
 *
 * This schema is also the ONLY gate on what a selected wild entry may become:
 * the translation step deliberately hands back untyped data, so every strict
 * bound below — the scheme allowlist, the CAIP-2 and canonical-address
 * patterns, the amount width, the timeout cap, the pinned
 * `extra.assetTransferMethod` — is enforced here, on every entry, after
 * selection.
 */
export const x402PaymentRequirementsSchema = z
  .looseObject({
    scheme: z.enum(X402_SUPPORTED_SCHEMES),
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
  accepts: z
    .array(x402PaymentRequirementsSchema)
    // `min(1)` is also the structural "nothing payable" gate: the normalizer
    // selects entries one at a time now, so an emptied `accepts` is what a
    // 402 with no supported option normalizes to. The normalizer returns its
    // own reasoned error first — this is the backstop that holds if a future
    // edit loses it, and the reason an empty array can never be forwarded.
    .min(1)
    .max(X402_MAX_ACCEPTS_ENTRIES),
  extensions: x402ExtensionsSchema.optional(),
});

export type X402PaymentRequirements = z.infer<
  typeof x402PaymentRequirementsSchema
>;
export type X402PaymentRequired = z.infer<typeof x402PaymentRequiredSchema>;

/**
 * The upstream x402 extension key a server advertises when it supports (or
 * requires) a client-supplied payment identifier
 * (`coinbase/x402` `specs/extensions/payment_identifier.md`).
 */
export const X402_PAYMENT_IDENTIFIER_EXTENSION_KEY = "payment-identifier";

function decodeBase64PaymentRequired(value: string): Result<unknown, string> {
  // Bound the ENCODED string before decoding it: `Buffer.from` allocates
  // three bytes per four base64 characters and `JSON.parse` then allocates
  // again, so checking the payload after decoding would be checking it after
  // paying for it. Length is checked before `.trim()` because trimming a
  // 50 MB string already copies it.
  if (value.length > X402_MAX_ENCODED_PAYLOAD_LENGTH) {
    return err(
      `x402 payment-required header is ${value.length} characters, above the ${X402_MAX_ENCODED_PAYLOAD_LENGTH}-character limit`,
    );
  }
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
 * Pools every resource URL the payload names — the top-level object or string
 * AND every per-entry string — and refuses a payload that names more than one.
 *
 * v2 carries the resource as a top-level object; v1 as a per-entry string. A
 * 402 naming DIFFERENT resources is not a dialect — it is a malformed (or
 * manipulated) 402. Never pick one (same stance as the conflicting-amounts
 * guard); a top-level url that disagrees with a per-entry one is caught too,
 * not silently preferred.
 *
 * Pooled over EVERY wild entry, including ones no translation can select, and
 * evaluated BEFORE selection. The fence is about the payload as a whole — the
 * coworker re-requests exactly one resource — so letting an unselectable entry
 * drop its url out of the pool would silence a disagreement rather than
 * resolve it.
 */
function poolResourceUrl(
  wild: z.infer<typeof wildPaymentRequiredSchema>,
): Result<string | undefined, string> {
  const topLevelResource =
    typeof wild.resource === "object" ? wild.resource.url : wild.resource;
  const resources = Array.from(
    new Set(
      [topLevelResource, ...wild.accepts.map((entry) => entry.resource)]
        // An empty or whitespace-only url is a MISSING value, not a second
        // name for the resource. Pooling it as a value produced
        // `Conflicting x402 resource URLs: , https://…` and refused a 402
        // that names exactly one resource. Trimming also stops surrounding
        // whitespace inventing a conflict between two spellings of one url.
        .map((value) => value?.trim())
        .filter(
          (value): value is string => value !== undefined && value.length > 0,
        ),
    ),
  );
  if (resources.length > 1) {
    // Up to 21 pooled URLs at 2048 characters each, so the echo is truncated
    // twice: per URL for the same reason the network and amount echoes are,
    // and again as a whole because 21 URLs each inside the per-value cap
    // still measured 1 890 characters — the per-value bound says nothing
    // about an echo built out of many values.
    return err(
      `Conflicting x402 resource URLs: ${truncateDetail(resources.map(truncateEcho).join(", "))}`,
    );
  }
  return ok(resources[0]);
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

  // Strip the prototype-polluting keys BEFORE anything reads the payload, so
  // no later step can forward one and none of them can reach a setter while
  // the payload is being rebuilt. See payment-required.sanitize.ts for why
  // the node — not Soko — is what this protects.
  const sanitized = stripPrototypePollutingKeys(candidate);
  if (sanitized.isErr()) {
    return err(sanitized.error);
  }
  candidate = sanitized.value;

  const wild = wildPaymentRequiredSchema.safeParse(candidate);
  if (!wild.success) {
    return err(
      `Unparseable x402 402 payload: ${truncateDetail(z.prettifyError(wild.error))}`,
    );
  }

  // Pooled BEFORE selection, over every wild entry: see poolResourceUrl.
  const resourceUrl = poolResourceUrl(wild.data);
  if (resourceUrl.isErr()) {
    return err(resourceUrl.error);
  }

  // `accepts` is a MENU — the client picks one option — so an option Soko
  // cannot settle costs that option and nothing else. Refusing the payload
  // per entry made a 402 that offers `exact` on Base alongside
  // `batch-settlement` (research 001 §2 records exactly that pairing on live
  // Base-mainnet resources) unpayable in full, while the listing side kept
  // the agent listed: "listed ⇒ payable" broken against a real listing.
  //
  // This is a SELECTION, not a repair. Nothing is guessed or clamped: an
  // entry that cannot be translated is dropped with its reason, every entry
  // that survives is still fully validated and canonicalized by
  // `x402PaymentRequiredSchema` below, and `narrowToChosenRequirement`
  // forwards exactly one of them to the node.
  const accepts: Record<string, unknown>[] = [];
  const refusals: string[] = [];
  for (const [index, entry] of wild.data.accepts.entries()) {
    const selected = selectPayableRequirement(entry);
    if (selected.isErr()) {
      refusals.push(`[${index}] ${selected.error}`);
      continue;
    }
    accepts.push(selected.value);
  }
  if (accepts.length === 0) {
    // Every reason, truncated as a whole: one refusal per entry at up to 20
    // entries is an echo built out of many attacker-controlled values, which
    // the per-value cap says nothing about.
    return err(
      `No payable x402 requirement in accepts (${refusals.length} refused): ${truncateDetail(refusals.join(" | "))}`,
    );
  }

  const normalized = {
    x402Version: wild.data.x402Version,
    accepts,
    ...(wild.data.error !== undefined ? { error: wild.data.error } : {}),
    ...(resourceUrl.value !== undefined
      ? { resource: { url: resourceUrl.value } }
      : {}),
    ...(wild.data.extensions !== undefined
      ? { extensions: wild.data.extensions }
      : {}),
  };

  const validated = x402PaymentRequiredSchema.safeParse(normalized);
  if (!validated.success) {
    return err(
      `Normalized x402 payload failed validation: ${truncateDetail(z.prettifyError(validated.error))}`,
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
 * `chosen` is VERIFIED against the payload rather than trusted. A helper
 * whose whole job is fund-diversion defence must not take the caller's word
 * for which entry the 402 offered: an unchecked `chosen` lets a caller bug —
 * a stale entry, one carried across a replay, one rebuilt by hand — hand the
 * node a `payTo` that never appeared in the payload Soko validated, which is
 * precisely the outcome this function exists to prevent. Identity is the
 * normal case; canonical-JSON equality covers a caller that round-tripped the
 * entry through JSON. The entry actually forwarded is always the payload's
 * own, never the argument, and the result is re-validated against the node
 * shape before it is returned.
 *
 * NOT dead code: the pay route lands on branch `x402-5-pay` and must call
 * this with the entry `verifyX402DemandAgainstAgentSources` returned. It
 * ships here because the schema owns the payload shape.
 *
 * Pure: the input payload is not mutated.
 */
export function narrowToChosenRequirement(
  paymentRequired: X402PaymentRequired,
  chosen: X402PaymentRequirements,
): Result<X402PaymentRequired, string> {
  const chosenKey = canonicalJsonKey(chosen);
  const member = paymentRequired.accepts.find(
    (entry) =>
      entry === chosen ||
      (chosenKey !== undefined && canonicalJsonKey(entry) === chosenKey),
  );
  if (member === undefined) {
    return err(
      "The chosen x402 requirement is not one of the payload's accepts entries",
    );
  }

  const narrowed = { ...paymentRequired, accepts: [member] };
  const validated = x402PaymentRequiredSchema.safeParse(narrowed);
  if (!validated.success) {
    return err(
      `Narrowed x402 payload failed validation: ${truncateDetail(z.prettifyError(validated.error))}`,
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
