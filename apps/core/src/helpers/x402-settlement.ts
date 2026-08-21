import { EVM_ADDRESS_PATTERN } from "@sokosumi/masumi";
import {
  normalizeX402NetworkId,
  X402_MAX_AMOUNT_DIGITS,
  X402_MAX_ENCODED_PAYLOAD_LENGTH,
} from "@sokosumi/masumi/schemas";
import { err, ok, type Result } from "neverthrow";

/**
 * Reads the EIP-3009 authorization out of a signed `X-PAYMENT` header
 * (ticket 011 Q3), shared between the pay producer — which asserts it against
 * the charged demand and stores the observation fields at VERIFIED — and the
 * future reconciler, which checks EIP-3009 authorizationState after expiry.
 *
 * Why the HEADER and not the node's `paymentPayload`: the header is the
 * bearer instrument. It is the string handed to the coworker, the string that
 * settles against Soko's managed wallet, and the only artifact whose contents
 * are the payment. `paymentPayload` is the node's own rendering of it —
 * a sibling field in the same JSON body, no more trustworthy than the summary
 * scalars beside it. Asserting against the rendering would let a compromised
 * node report the charged terms while the header signs something else.
 */

/** The transfer a signed `X-PAYMENT` header actually authorizes. */
export interface SignedX402Authorization {
  /** Wire protocol version, which also determines the HTTP replay header. */
  x402Version: 1 | 2;
  /** EIP-3009 `from` — the wallet the transfer debits. Lowercased. */
  from: string;
  /** EIP-3009 `to` — the recipient the signature pays. Lowercased. */
  to: string;
  /** EIP-3009 `value` — base units the signature moves. */
  value: bigint;
  /**
   * The v2 payload's `accepted.scheme` VERBATIM — the settlement semantics the signature
   * was produced under.
   *
   * Not trimmed and not lowercased, because a facilitator reads this field
   * exactly as written. Folding it meant `"Exact"` and `"  exact  "` cleared
   * Soko's supported-scheme fence and then settled against nothing: the fence
   * was checking a string that does not exist anywhere downstream. The 402
   * side is already strict (`z.enum(["exact"])`), so folding here was the lone
   * asymmetry.
   *
   * Read but NOT policed here: which schemes Soko is willing to have signed is
   * the caller's decision, checked against the charge (see
   * `X402_SUPPORTED_SCHEMES`).
   */
  scheme: string;
  /**
   * The v2 payload's `accepted.network` as a canonical CAIP-2 id — the chain the signature
   * settles on. Folded through the same normalizer the 402 goes through, so
   * the caller compares chains rather than spellings.
   *
   * The EIP-712 domain is reconstructed from `accepted.network` and
   * `accepted.asset`, so both accepted fields must match the charged demand.
   */
  network: string;
  /** v2 accepted token contract; v1 carries this only in server requirements. */
  asset: string | null;
  /** v2 accepted amount; v1 carries this only in server requirements. */
  amount: bigint | null;
  /** v2 accepted recipient; v1 carries this only in server requirements. */
  payTo: string | null;
  /** v2 accepted authorization lifetime; v1 carries this only in requirements. */
  maxTimeoutSeconds: number | null;
  /** EIP-712 domain values echoed by v2 accepted terms. */
  domainName: string | null;
  domainVersion: string | null;
  assetTransferMethod: string | null;
  /** EIP-3009 replay key: exactly one 32-byte hex value. */
  nonce: string;
  /** EIP-712 signature over the EIP-3009 authorization. */
  signature: `0x${string}`;
  /** EIP-3009 authorization expiry. */
  validBefore: Date;
  /** EIP-3009 authorization opening time; unix epoch zero is valid. */
  validAfter: Date;
}

export interface X402PaymentHeaderDescriptor {
  x402Version: 1 | 2;
  name: "X-PAYMENT" | "PAYMENT-SIGNATURE";
  value: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodePaymentHeader(
  paymentHeader: string,
): Result<Record<string, unknown>, string> {
  if (paymentHeader.length > X402_MAX_ENCODED_PAYLOAD_LENGTH) {
    return err(
      `x402 payment header is ${paymentHeader.length} characters, above the ${X402_MAX_ENCODED_PAYLOAD_LENGTH}-character limit`,
    );
  }
  const encoded = paymentHeader.trim();
  try {
    const bytes = Buffer.from(encoded, "base64");
    // Node's base64 decoder is intentionally forgiving: it ignores junk,
    // accepts URL-safe spellings, and tolerates missing padding. A bearer
    // header must have one byte-for-byte representation so replay, storage,
    // and size checks all describe the same credential.
    if (bytes.toString("base64") !== encoded) {
      return err("x402 payment header is not canonical base64");
    }
    const decoded = JSON.parse(bytes.toString("utf8"));
    const envelope = asRecord(decoded);
    return envelope === null
      ? err("x402 payment header is not a JSON object")
      : ok(envelope);
  } catch {
    return err("x402 payment header is not base64-encoded JSON");
  }
}

function readX402Version(
  envelope: Record<string, unknown>,
): Result<1 | 2, string> {
  return envelope.x402Version === 1 || envelope.x402Version === 2
    ? ok(envelope.x402Version)
    : err("x402 payment header declares an unsupported protocol version");
}

export function describeX402PaymentHeader(
  paymentHeader: string,
): Result<X402PaymentHeaderDescriptor, string> {
  const decoded = decodePaymentHeader(paymentHeader);
  if (decoded.isErr()) return err(decoded.error);
  const version = readX402Version(decoded.value);
  if (version.isErr()) return err(version.error);
  const value = Buffer.from(JSON.stringify(decoded.value), "utf8").toString(
    "base64",
  );
  return ok({
    x402Version: version.value,
    name: version.value === 1 ? "X-PAYMENT" : "PAYMENT-SIGNATURE",
    value,
  });
}

/**
 * Restores the resource server's exact v2 requirement spelling in `accepted`.
 * The EIP-3009 signature covers `payload.authorization`, not this echo; using
 * the original object keeps checksummed EVM addresses and extension keys
 * compatible with SDKs that structurally match `accepted` before settlement.
 */
export function prepareX402ReplayHeader(
  paymentHeader: string,
  sourceRequirement: Readonly<Record<string, unknown>>,
): Result<X402PaymentHeaderDescriptor, string> {
  const decoded = decodePaymentHeader(paymentHeader);
  if (decoded.isErr()) return err(decoded.error);
  const version = readX402Version(decoded.value);
  if (version.isErr()) return err(version.error);
  if (version.value === 1) {
    // Re-encode v1 too. This removes surrounding transport whitespace and
    // makes stored/replayed credentials canonical just like v2.
    const value = Buffer.from(JSON.stringify(decoded.value), "utf8").toString(
      "base64",
    );
    return ok({ x402Version: 1, name: "X-PAYMENT", value });
  }

  const value = Buffer.from(
    JSON.stringify({ ...decoded.value, accepted: sourceRequirement }),
    "utf8",
  ).toString("base64");
  if (value.length > X402_MAX_ENCODED_PAYLOAD_LENGTH) {
    return err("normalized x402 replay header exceeds the encoded size limit");
  }
  return ok({ x402Version: 2, name: "PAYMENT-SIGNATURE", value });
}

/** Lowercased EVM address, or null when the field is not one. */
function readAddress(value: unknown): string | null {
  if (typeof value !== "string" || !EVM_ADDRESS_PATTERN.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

/**
 * Token base units as a BigInt, or null when the value is not base units.
 *
 * Digit-string only — deliberately NOT accepting a JSON number. Base units go
 * past 2^53 (an 18-decimal token reaches it at 9 whole units), so a numeric
 * spelling has already lost precision by the time it is parsed, and silently
 * accepting it would compare a rounded value against the exact charge.
 *
 * Width-bounded before the BigInt conversion, which is quadratic — the same
 * uint256 decimal width the 402 normalizer bounds amounts to.
 *
 * Exported because every base-unit comparison on the money path has to agree
 * on what a base-unit string is: the amounts the node reports and the amount
 * charged are compared against each other and against this authorization.
 */
export function parseX402BaseUnits(value: unknown): bigint | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > X402_MAX_AMOUNT_DIGITS ||
    !/^\d+$/.test(value)
  ) {
    return null;
  }
  return BigInt(value);
}

/**
 * An EIP-712 signature: `0x` followed by whole bytes of hex, at least 32 of
 * them.
 *
 * No EXACT width is pinned, deliberately — a plain ECDSA signature is 65
 * bytes, but an ERC-1271 smart-account signature is arbitrarily long and just
 * as settleable, so a fixed length would refuse real headers. A floor and byte
 * alignment refuse none: `0xdeadbeef` is four bytes, recovers no signer under
 * any scheme, and an odd digit count is not bytes at all. Shape alone accepted
 * both, which made the check satisfiable by a placeholder — the exact thing it
 * exists to catch.
 *
 * The point of checking at all is that a header with no usable signature
 * authorizes nothing: it cannot move a cent, on any chain, ever.
 */
const EVM_SIGNATURE_PATTERN = /^0x(?:[0-9a-fA-F]{2}){32,}$/;
const EIP_3009_NONCE_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * EIP-3009 `validBefore` / `validAfter` are unix-seconds timestamps; the wire
 * spelling may be a digit string or a number.
 */
function readUnixSeconds(value: unknown, allowZero: boolean): Date | null {
  const seconds =
    typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : typeof value === "number" && Number.isSafeInteger(value)
        ? value
        : null;
  // Validate the CONSTRUCTED Date, not just `seconds`: a finite but enormous
  // value (a manipulated or garbage validBefore) overflows the JS Date range
  // and yields an Invalid Date whose getTime() is NaN. Storing that in a
  // Prisma DateTime — and handing it to the future reconciler — is worse than
  // storing null, so drop it.
  // `validAfter = 0` is the standard "valid immediately" EIP-3009 spelling;
  // validBefore must be positive. Both numeric spellings must be integers — a
  // fractional timestamp has no contract-level representation.
  if (
    seconds === null ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    (!allowZero && seconds === 0)
  ) {
    return null;
  }
  const candidate = new Date(seconds * 1000);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

/**
 * Decodes the base64 `X-PAYMENT` header and returns the EIP-3009
 * authorization it carries (`{ payload: { authorization: … } }`), or an error
 * describing why it could not be read.
 *
 * `to`, `value` and `from` are REQUIRED and the failure is hard. They are the
 * three facts that say who gets paid how much out of whose wallet, so a
 * caller that cannot read them cannot tell a correctly signed payment from
 * one re-targeted at an attacker. The safe answer is to refuse — leaving the
 * payment record PENDING, refund-safe and replayable — never to shrug and
 * store the header as VERIFIED with the facts unchecked.
 *
 * `payload.signature` and the v2 payload's `accepted` terms are required for
 * the same reason, one step further out. Those three answer WHETHER the
 * instrument can settle at all, and nothing read them: a header with no
 * signature, or one naming a chain the charge was never priced on, described a
 * perfectly coherent transfer and so passed every who/how-much assertion. The
 * result was a charge parked on a VERIFIED row — the one status the refusal
 * refund explicitly declines to touch — behind an instrument that can never
 * move a cent. Unreadable here means the same thing it means above: hold the
 * payment PENDING, do not refund (the node did sign), and let the same-key
 * replay or an operator resolve it.
 *
 * Nonce and validity terms are required too. They are EIP-3009's replay key
 * and execution window; accepting malformed values would mark an instrument
 * VERIFIED even though the token contract can never execute it. Whether a
 * well-formed window has passed remains the caller's clock-sensitive check.
 */
export function parseSignedX402Authorization(
  xPaymentHeader: string,
): Result<SignedX402Authorization, string> {
  const decoded = decodePaymentHeader(xPaymentHeader);
  if (decoded.isErr()) return err(decoded.error);
  const envelope = decoded.value;
  const version = readX402Version(envelope);
  if (version.isErr()) return err(version.error);
  const payload = asRecord(envelope.payload);
  const accepted = asRecord(envelope.accepted);
  const fields = payload === null ? null : asRecord(payload.authorization);
  if (payload === null || fields === null) {
    return err("x402 payment header carries no payload.authorization");
  }
  if (version.value === 2 && accepted === null) {
    return err("x402 v2 payment header carries no accepted terms");
  }

  // Without a signature the header is a description of a payment, not a
  // payment. Checked before the money fields so the cheapest disqualifier
  // reports itself as itself.
  if (
    typeof payload.signature !== "string" ||
    !EVM_SIGNATURE_PATTERN.test(payload.signature)
  ) {
    return err("x402 payment header carries no usable payload.signature");
  }

  const scheme = version.value === 1 ? envelope.scheme : accepted?.scheme;
  const declaredNetwork =
    version.value === 1 ? envelope.network : accepted?.network;
  if (typeof scheme !== "string" || scheme.trim() === "") {
    return err("x402 payment header declares no scheme");
  }
  if (typeof declaredNetwork !== "string") {
    return err("x402 payment header declares no network");
  }
  // Folded through the 402's own normalizer, so a v1 alias for the charged
  // chain is the same chain and an unknown spelling is a refusal rather than a
  // guess — guessing a chain id here would bless a signature that settles
  // somewhere the charge never priced.
  const network = normalizeX402NetworkId(declaredNetwork);
  if (network.isErr()) {
    // The normalizer's message already truncates the echoed value.
    return err(`x402 payment header declares an unusable network`);
  }

  const from = readAddress(fields.from);
  const to = readAddress(fields.to);
  const value = parseX402BaseUnits(fields.value);
  const asset = version.value === 2 ? readAddress(accepted?.asset) : null;
  const amount =
    version.value === 2 ? parseX402BaseUnits(accepted?.amount) : null;
  const payTo = version.value === 2 ? readAddress(accepted?.payTo) : null;
  const maxTimeoutSeconds =
    version.value === 2 &&
    typeof accepted?.maxTimeoutSeconds === "number" &&
    Number.isSafeInteger(accepted.maxTimeoutSeconds) &&
    accepted.maxTimeoutSeconds > 0
      ? accepted.maxTimeoutSeconds
      : null;
  if (
    from === null ||
    to === null ||
    value === null ||
    (version.value === 2 &&
      (asset === null ||
        amount === null ||
        payTo === null ||
        maxTimeoutSeconds === null))
  ) {
    // Name the fields, never echo them: this string reaches a Sentry capture
    // and the value is attacker-influenced.
    const missing = [
      from === null ? "from" : null,
      to === null ? "to" : null,
      value === null ? "value" : null,
      version.value === 2 && asset === null ? "accepted.asset" : null,
      version.value === 2 && amount === null ? "accepted.amount" : null,
      version.value === 2 && payTo === null ? "accepted.payTo" : null,
      version.value === 2 && maxTimeoutSeconds === null
        ? "accepted.maxTimeoutSeconds"
        : null,
    ].filter((field) => field !== null);
    return err(
      `x402 payment header authorization is missing or malformed: ${missing.join(", ")}`,
    );
  }

  const extra = version.value === 2 ? asRecord(accepted?.extra) : null;
  const readOptionalString = (value: unknown): string | null | undefined =>
    value === undefined ? null : typeof value === "string" ? value : undefined;
  const domainName = readOptionalString(extra?.name);
  const domainVersion = readOptionalString(extra?.version);
  const assetTransferMethod = readOptionalString(extra?.assetTransferMethod);
  if (
    domainName === undefined ||
    domainVersion === undefined ||
    assetTransferMethod === undefined
  ) {
    return err("x402 payment header carries malformed accepted.extra terms");
  }

  const nonce =
    typeof fields.nonce === "string" &&
    EIP_3009_NONCE_PATTERN.test(fields.nonce)
      ? fields.nonce.toLowerCase()
      : null;
  const validBefore = readUnixSeconds(fields.validBefore, false);
  const validAfter = readUnixSeconds(fields.validAfter, true);
  if (nonce === null || validBefore === null || validAfter === null) {
    const malformed = [
      nonce === null ? "nonce" : null,
      validBefore === null ? "validBefore" : null,
      validAfter === null ? "validAfter" : null,
    ].filter((field) => field !== null);
    return err(
      `x402 payment header authorization is missing or malformed: ${malformed.join(", ")}`,
    );
  }
  if (validAfter.getTime() >= validBefore.getTime()) {
    return err(
      "x402 payment header authorization has an empty or reversed validity window",
    );
  }

  return ok({
    x402Version: version.value,
    from,
    to,
    value,
    // Verbatim — see SignedX402Authorization.scheme.
    scheme,
    network: network.value,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds,
    domainName,
    domainVersion,
    assetTransferMethod,
    nonce,
    signature: payload.signature as `0x${string}`,
    validBefore,
    validAfter,
  });
}
