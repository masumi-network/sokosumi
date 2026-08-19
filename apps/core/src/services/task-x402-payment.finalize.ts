import * as Sentry from "@sentry/node";
import { TaskX402PaymentStatus } from "@sokosumi/database";
import { CAIP2_EVM_NETWORK_PATTERN } from "@sokosumi/masumi";
import type { X402SignedPayment } from "@sokosumi/masumi/clients";
import {
  X402_MAX_TIMEOUT_SECONDS,
  X402_SUPPORTED_SCHEMES,
} from "@sokosumi/masumi/schemas";
import { type Address, type Hex, verifyTypedData } from "viem";

import { badGateway, conflict, internalServerError } from "@/helpers/error";
import {
  parseSignedX402Authorization,
  parseX402BaseUnits,
  prepareX402ReplayHeader,
  type SignedX402Authorization,
} from "@/helpers/x402-settlement";
import prisma from "@/lib/db/prisma";
import type { TaskX402PaymentSigned } from "@/schemas/x402-payment.schema";
import {
  buildStoredSignedResponse,
  X402_CLOCK_SKEW_TOLERANCE_MS,
  X402_MIN_REMAINING_VALIDITY_MS,
} from "@/services/task-x402-payment.replay";

/**
 * The finalize concern of the coworker x402 pay flow (PR1-SPEC §3.6): what
 * happens to a PENDING record once the node answers 200.
 *
 * Split from the pay service by responsibility — the service owns the charge,
 * the node call and the refund doctrine; this module owns the single question
 * "is the thing the node handed back actually the thing that was paid for, and
 * can it settle?" — so that question has one home, its own tests, and room to
 * grow without pushing the service past the file-size ceiling.
 *
 * Every answer other than "yes" lands on {@link heldPendingSignOutcome}: the
 * record stays PENDING, the charge is held, and NOTHING is refunded inline.
 * The node signed; a header may exist. Refunding here is the one action that
 * cannot be taken back.
 */

/** The charged demand a signed node result is checked back against (L2). */
export interface ChargedX402Demand {
  x402Version: 1 | 2;
  /** Canonical lowercase CAIP-2 network id. */
  caip2Network: string;
  /** Canonical lowercase ERC-20 address. */
  asset: string;
  /** Charged amount in token base units. */
  amount: string;
  /** Recipient as verified/charged. */
  payTo: string;
  scheme: string;
  maxTimeoutSeconds: number;
  domainName: string;
  domainVersion: string;
  assetTransferMethod: string | null;
  /** Exact server requirement restored into a v2 header's accepted echo. */
  sourceRequirement: Readonly<Record<string, unknown>>;
  /** Canonical managed-wallet address selected before the debit. */
  evmWalletAddress: string;
}

/**
 * The 502 every unverifiable sign outcome lands on: the record stays PENDING,
 * its persisted sign-risk fence prevents an early operator refund, and the
 * same-key replay can re-run the sign. Deliberately identical to the
 * lost-in-transit answer — the coworker
 * cannot act differently on "we could not read it" than on "we never saw it",
 * and the distinction is an ops signal, which is why each caller pages first.
 */
export function heldPendingSignOutcome(): never {
  throw badGateway(
    "x402 sign outcome unknown: the payment node's signed result could not be verified against the charge. " +
      "The charge is held on a pending record; retry with the SAME idempotencyKey to re-run the sign.",
    { kind: "x402_pay_outcome_unknown" },
  );
}

/**
 * The page-then-hold pairing every unverifiable sign outcome in this module
 * must follow: capture the ops signal FIRST, then throw the held-PENDING 502
 * (see {@link heldPendingSignOutcome} for why the caller-facing answer is
 * deliberately uniform). One helper makes the pairing structural — a new
 * branch cannot hold the charge silently, which is the invisible-wedge state
 * where support only learns about a stuck PENDING charge when the coworker
 * asks. Callers needing `captureException` (a raw error object) or a
 * non-error level page manually and call {@link heldPendingSignOutcome}
 * directly.
 */
function pageAndHoldPending(
  message: string,
  errorType: string,
  extra: Record<string, unknown>,
): never {
  Sentry.captureMessage(message, {
    level: "error",
    tags: { error_type: errorType },
    extra,
  });
  heldPendingSignOutcome();
}

/**
 * The latest `validBefore` an honestly signed authorization can carry.
 *
 * `maxTimeoutSeconds` on every forwarded `accepts` entry is schema-capped at
 * `X402_MAX_TIMEOUT_SECONDS`, and the x402 exact-EVM client signs
 * `validBefore = signTime + maxTimeoutSeconds` — so no node Soko forwards to
 * can mint a longer window, plus whatever its clock runs ahead by.
 *
 * Without this fence the expiry check had only a lower bound. A `validBefore`
 * of "99999999999" (Wed Nov 16 5138) or "253402300799" (Sat Jan 01 10000)
 * parses to a perfectly valid Date, describes the charged transfer correctly,
 * and was written VERIFIED — leaving a bearer credential against Soko's
 * managed wallet stored essentially forever, in a band that ESCAPES BOTH purge
 * arms (not `lte: now`, and not null). Only a value beyond ~8.64e12 seconds
 * overflows the Date range and falls back to null.
 *
 * EXPORTED for the purge's sake, not for any caller here. This is the upper
 * bound on how far ahead a `validBefore` on a stored row may sit, so
 * `X402_UNDATED_HEADER_TTL_MS` — the purge's absolute cutoff — must stay
 * strictly BEYOND it, or the sweep would null a header still inside its
 * window. The purge derives its cutoff from this constant by direct import,
 * so the inequality holds by construction. The per-charge runtime fence in
 * `firstUnsettleableReason` applies the same formula with the demand's own
 * `maxTimeoutSeconds`; this constant is that fence's supremum, so widening
 * the inline fence past the schema cap or the skew tolerance MUST also widen
 * this constant (and with it the purge TTL).
 */
export const X402_MAX_PLAUSIBLE_VALIDITY_MS =
  X402_MAX_TIMEOUT_SECONDS * 1000 + X402_CLOCK_SKEW_TOLERANCE_MS;

const EIP_3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

async function hasValidEip3009Signature(
  authorization: SignedX402Authorization,
  charged: ChargedX402Demand,
): Promise<boolean> {
  // The canonical pattern, not a hand-rolled parse: `charged.caip2Network` is
  // canonical by construction (schema-validated and allowlisted), so the one
  // parser everything else uses is the one that must derive the chainId here
  // — a private, laxer copy would drift silently on the next pattern change.
  const match = CAIP2_EVM_NETWORK_PATTERN.exec(charged.caip2Network);
  const reference = match?.[1];
  if (reference === undefined) {
    return false;
  }

  try {
    return await verifyTypedData({
      address: charged.evmWalletAddress as Address,
      domain: {
        name: charged.domainName,
        version: charged.domainVersion,
        chainId: BigInt(reference),
        verifyingContract: charged.asset as Address,
      },
      types: EIP_3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from as Address,
        to: authorization.to as Address,
        value: authorization.value,
        validAfter: BigInt(
          Math.floor(authorization.validAfter.getTime() / 1000),
        ),
        validBefore: BigInt(
          Math.floor(authorization.validBefore.getTime() / 1000),
        ),
        nonce: authorization.nonce as Hex,
      },
      signature: authorization.signature,
    });
  } catch {
    return false;
  }
}

/**
 * Why a signed header could never settle the charge it was produced for, or
 * null when nothing rules it out.
 *
 * The who/how-much assertion above answers "does this authorize the transfer
 * that was paid for". It cannot answer "can this transfer ever happen": a
 * header naming another chain, signed under another scheme's settlement
 * semantics, or outside its own validity window describes the charged transfer
 * perfectly and still moves nothing. Every one of those was accepted and
 * written VERIFIED — the status `refundRefusedTaskX402Payment` explicitly
 * declines to refund — leaving the buyer's credits behind an instrument that
 * cannot be used and an operator ticket to get them back.
 *
 * Returns a CODE, never a message built from node data: the value reaches a
 * Sentry capture and, through the generic 502, nothing else.
 */
function firstUnsettleableReason(
  authorization: SignedX402Authorization,
  charged: ChargedX402Demand,
  now: Date,
): string | null {
  if (authorization.x402Version !== charged.x402Version)
    return "version_mismatch";
  if (!X402_SUPPORTED_SCHEMES.some((scheme) => scheme === authorization.scheme))
    return "scheme_unsupported";
  // The chain the signature is bound to. The EIP-712 domain is reconstructed
  // from the header's v2 `accepted` terms, so this compares its canonical
  // chain with the charged chain rather than comparing spellings.
  if (authorization.network !== charged.caip2Network) return "network_mismatch";
  if (
    authorization.x402Version === 2 &&
    (authorization.scheme !== charged.scheme ||
      authorization.maxTimeoutSeconds !== charged.maxTimeoutSeconds ||
      authorization.domainName !== charged.domainName ||
      authorization.domainVersion !== charged.domainVersion ||
      (authorization.assetTransferMethod ?? "eip3009") !==
        (charged.assetTransferMethod ?? "eip3009"))
  ) {
    return "signing_domain_mismatch";
  }
  const usableFrom = Math.max(
    now.getTime(),
    authorization.validAfter.getTime(),
  );
  if (
    authorization.validBefore.getTime() - usableFrom <
    X402_MIN_REMAINING_VALIDITY_MS
  )
    return "insufficient_remaining_lifetime";
  // The upper fence. An expiry no honest node can have signed is not a longer
  // grant, it is a header Soko refuses to store — see
  // X402_MAX_PLAUSIBLE_VALIDITY_MS. Routed to the PENDING hold like every
  // other unsettleable reason: the node DID sign, so this must not refund.
  if (
    authorization.validBefore.getTime() >
    now.getTime() +
      charged.maxTimeoutSeconds * 1000 +
      X402_CLOCK_SKEW_TOLERANCE_MS
  )
    return "expiry_implausible";
  if (
    authorization.validAfter.getTime() >
    now.getTime() + X402_CLOCK_SKEW_TOLERANCE_MS
  )
    return "not_yet_valid";
  return null;
}

export async function finalizeVerifiedTaskX402Payment(
  paymentId: string,
  signed: X402SignedPayment,
  charged: ChargedX402Demand,
  taskId: string,
): Promise<TaskX402PaymentSigned> {
  const caip2Network = signed.caip2Network.toLowerCase();
  const asset = signed.asset.toLowerCase();

  // Read the authorization out of the HEADER, which is the bearer instrument
  // itself — not out of `signed.paymentPayload`, which is the node's own
  // rendering of it and exactly as trustworthy as the summary scalars beside
  // it. A header Soko cannot read is a header Soko cannot verify, so this is
  // a HARD failure: storing it VERIFIED would hand back a bearer instrument
  // nobody checked.
  const parsed = parseSignedX402Authorization(signed.xPaymentHeader);
  if (parsed.isErr()) {
    pageAndHoldPending(
      "x402 signed payment header could not be read; PENDING record held",
      "task_x402_payment_header_unreadable",
      { taskId, paymentId, reason: parsed.error },
    );
  }
  const authorization = parsed.value;

  // Defense-in-depth (L2): credits were charged for the verified demand, but
  // the node returns its own account of what it signed. Two layers, because
  // they catch different lies:
  //
  //  - the SUMMARY scalars (caip2Network/asset/amount/payTo) catch a node
  //    that openly reports something other than the charged demand;
  //  - the signed AUTHORIZATION (to/value/from) catches the one that matters,
  //    a node that reports the charged demand truthfully while the header it
  //    hands back authorizes a transfer elsewhere. The summary check alone
  //    cannot see that: those fields are siblings of the header in the same
  //    JSON body, and only the authorization settles.
  //
  // Amounts compare as BigInt, never as strings: the node spec types `amount`
  // as ^\d+$, which permits "0250000", and a string compare would call that a
  // mismatch — stranding the charge PENDING and discarding a header Soko paid
  // for. An unparseable amount is a mismatch, not a crash.
  //
  // On mismatch, leave the record PENDING behind its sign-risk fence and
  // return the ambiguous 502; never write the node's version.
  const signedAmount = parseX402BaseUnits(signed.amount);
  const chargedAmount = parseX402BaseUnits(charged.amount);
  if (
    caip2Network !== charged.caip2Network ||
    asset !== charged.asset ||
    (authorization.x402Version === 2 &&
      authorization.asset !== charged.asset) ||
    signedAmount === null ||
    chargedAmount === null ||
    signedAmount !== chargedAmount ||
    (authorization.x402Version === 2 &&
      authorization.amount !== chargedAmount) ||
    signed.payTo.toLowerCase() !== charged.payTo.toLowerCase() ||
    (authorization.x402Version === 2 &&
      authorization.payTo !== charged.payTo.toLowerCase()) ||
    authorization.to !== charged.payTo.toLowerCase() ||
    authorization.value !== chargedAmount ||
    authorization.from !== signed.payer.toLowerCase() ||
    authorization.from !== charged.evmWalletAddress
  ) {
    pageAndHoldPending(
      "x402 signed tuple did not match the charged demand; PENDING record held",
      "task_x402_payment_signed_mismatch",
      {
        taskId,
        paymentId,
        charged,
        signed: {
          caip2Network,
          asset,
          amount: signed.amount,
          payTo: signed.payTo,
          payer: signed.payer,
        },
        // What the header actually authorizes — the field that settles.
        authorized: {
          to: authorization.to,
          value: authorization.value.toString(),
          from: authorization.from,
          acceptedAsset: authorization.asset,
          acceptedAmount: authorization.amount?.toString() ?? null,
          acceptedPayTo: authorization.payTo,
        },
      },
    );
  }

  // L2b: the header authorizes the right transfer — but can that transfer ever
  // happen? Checked AFTER the tuple assert so a re-targeted header still pages
  // as the more serious `signed_mismatch` rather than being masked by, say, an
  // expiry it also has.
  //
  // Same doctrine as every other unverifiable outcome, and it matters most
  // here: the node DID sign, so this must NEVER refund inline. Hold PENDING —
  // replayable with the same key, and reachable by the operator only after
  // its conservative sign-risk window expires
  // refund — instead of writing the terminal VERIFIED the refund path refuses.
  const unsettleable = firstUnsettleableReason(
    authorization,
    charged,
    new Date(),
  );
  if (unsettleable !== null) {
    pageAndHoldPending(
      "x402 signed header cannot settle the charge; PENDING record held",
      "task_x402_payment_unsettleable_header",
      {
        taskId,
        paymentId,
        reason: unsettleable,
        attemptId: signed.attemptId,
        chargedNetwork: charged.caip2Network,
        headerNetwork: authorization.network,
        headerScheme: authorization.scheme,
        validAfter: authorization.validAfter.toISOString(),
        validBefore: authorization.validBefore.toISOString(),
      },
    );
  }

  // Shape and tuple checks do not prove the managed wallet signed anything.
  // Recover against the exact EIP-712/EIP-3009 domain and message before the
  // row can enter VERIFIED; a hostile node can invent every sibling scalar.
  if (!(await hasValidEip3009Signature(authorization, charged))) {
    pageAndHoldPending(
      "x402 signed header failed EIP-712 verification; PENDING record held",
      "task_x402_payment_signature_invalid",
      { taskId, paymentId, attemptId: signed.attemptId },
    );
  }

  const replayHeader = prepareX402ReplayHeader(
    signed.xPaymentHeader,
    charged.sourceRequirement,
  );
  if (replayHeader.isErr()) {
    pageAndHoldPending(
      "x402 signed header could not be normalized for resource replay; PENDING record held",
      "task_x402_payment_replay_header_invalid",
      { taskId, paymentId, reason: replayHeader.error },
    );
  }

  let updated: { count: number };
  try {
    updated = await prisma.taskX402Payment.updateMany({
      where: { id: paymentId, status: TaskX402PaymentStatus.PENDING },
      data: {
        status: TaskX402PaymentStatus.VERIFIED,
        attemptId: signed.attemptId,
        xPaymentHeader: replayHeader.value.value,
        // The signed tuple — preferredNetwork/preferredAsset pinned it to the
        // verified pair, so this can only restate the demand.
        caip2Network,
        asset,
        // The CHARGED spelling, not the node's. The assert above compared the
        // two as BigInt, deliberately, because "0250000" is a legal node
        // spelling of "250000" — but `assertReplayMatchesStoredDemand` compares
        // this column as a STRING against the re-verified demand. Storing the
        // node's spelling therefore made the row unreachable by its own
        // idempotency key: a lost 200 replayed as 409 "use a new
        // idempotencyKey", and following that advice mints a SECOND debit for a
        // header that already exists.
        //
        // `charged.amount`, NOT a re-canonicalized `chargedAmount.toString()`:
        // `normalizeAmount` passes a 402's amount through verbatim, so a 402
        // that itself says "0250000" charged and created the row with that
        // spelling. Canonicalizing here would strand the key from the other
        // direction. The value is already on the row — this write restates it,
        // which is the point.
        amount: charged.amount,
        // `charged.payTo`, NOT `signed.payTo`: the PENDING insert stored the
        // canonical lowercase payTo from the verified demand, and the assert
        // above only proved the node's spelling matches case-insensitively.
        // Writing the node's casing here would de-canonicalize the column and
        // let attacker-influenced casing reach the admin UI and the coworker
        // response — the same one-layer-down dependency on downstream
        // `.toLowerCase()` guards that the 402 path already removed for payTo.
        payTo: charged.payTo,
        // The canonical lowercase payer the assert above just used, NOT the
        // node's casing. `@@unique([caip2Network, asset, payerAddress,
        // payloadNonce])` is a byte comparison — it mirrors the chain's promise
        // that one (payer, nonce) authorization settles exactly once — so an
        // EIP-55 checksummed spelling and its lowercase twin occupy different
        // index keys and BOTH insert: two credit debits behind one settleable
        // transfer. `caip2Network` and `asset` in this same write are already
        // folded; this was the odd one out.
        payerAddress: authorization.from,
        paymentPayloadHash: signed.paymentPayloadHash,
        payloadNonce: authorization.nonce,
        validBefore: authorization.validBefore,
        signRiskExpiresAt: authorization.validBefore,
        failureReason: null,
      },
    });
  } catch (error) {
    // The `data` above includes the bearer header. A
    // PrismaClientValidationError message renders the provided query
    // arguments — header included — so the raw error must never reach Sentry
    // from THIS catch unless it is a coded Prisma request error (those carry
    // only column names in `meta`; duck-typed on `code`, the same convention
    // as helpers/prisma.ts, because the generated namespace exposes no
    // runtime class here). Everything else — validation errors included — is
    // reduced to its name, mirroring the module policy that captures name
    // attemptId/nonce but never the header.
    const hasPrismaErrorCode =
      typeof error === "object" &&
      error !== null &&
      typeof (error as { code?: unknown }).code === "string";
    const safeError = hasPrismaErrorCode
      ? error
      : new Error(
          `x402 finalize persistence failed: ${
            error instanceof Error ? error.name : typeof error
          }`,
        );
    Sentry.captureException(safeError, {
      tags: { error_type: "task_x402_payment_finalize_persistence_failed" },
      extra: {
        taskId,
        paymentId,
        attemptId: signed.attemptId,
        payloadNonce: authorization.nonce,
      },
    });
    heldPendingSignOutcome();
  }
  if (updated.count !== 1) {
    // A concurrent replay of the same key may have finalized first; its
    // stored result is the answer. Anything else is a real inconsistency.
    const record = await prisma.taskX402Payment.findUnique({
      where: { id: paymentId },
    });
    if (record?.status === TaskX402PaymentStatus.VERIFIED) {
      if (record.attemptId !== signed.attemptId) {
        // The other half of the backstop below, and the same event: two node
        // signs happened for one record, so a live EIP-3009 authorization
        // exists that Soko signed and is about to discard. The lease is what
        // prevents this; reaching it means a lease expired under a stalled
        // holder. Money-safe — one header per record, always the stored one,
        // so the caller still gets a correct 200 — which is precisely why it
        // was invisible. Same shape as the sibling: attemptId and the nonce so
        // ops can find the orphan node-side, never the header itself.
        Sentry.captureMessage(
          "x402 payment signed twice; the later header is discarded",
          {
            level: "error",
            tags: { error_type: "task_x402_payment_signed_after_verify" },
            extra: {
              taskId,
              paymentId,
              storedAttemptId: record.attemptId,
              discardedAttemptId: signed.attemptId,
              discardedPayloadNonce: authorization.nonce,
              discardedValidBefore: authorization.validBefore.toISOString(),
            },
          },
        );
      }
      return buildStoredSignedResponse(record);
    }
    if (
      record?.status === TaskX402PaymentStatus.FAILED ||
      record?.status === TaskX402PaymentStatus.REFUNDED
    ) {
      // The worst state this flow can reach: the node DID sign, but another
      // request already refunded the charge and closed the row, so a live
      // EIP-3009 authorization exists that Soko signed and is now discarding.
      // The sign lease is what prevents the concurrent case; this is the
      // backstop for a lease that expired under a stalled holder, and it is
      // paged loudly rather than folded into a bare 500 — the header itself is
      // NOT logged (it is a bearer instrument), but attemptId and the
      // authorization nonce are, so ops can find it node-side.
      Sentry.captureMessage(
        "x402 payment signed after its record was closed; header discarded",
        {
          level: "error",
          tags: { error_type: "task_x402_payment_signed_after_close" },
          extra: {
            taskId,
            paymentId,
            status: record.status,
            attemptId: signed.attemptId,
            payloadNonce: authorization.nonce,
            validBefore: authorization.validBefore.toISOString(),
          },
        },
      );
      throw conflict(
        `This idempotencyKey was consumed by a ${record.status.toLowerCase()} x402 payment while this request was signing. ` +
          "Its charge was refunded; use a new idempotencyKey for a new payment intent.",
        { kind: "x402_payment_key_consumed" },
      );
    }
    Sentry.captureMessage(
      "x402 payment could not be finalized after a successful sign",
      {
        level: "error",
        tags: { error_type: "task_x402_payment_finalize_failed" },
        extra: {
          taskId,
          paymentId,
          status: record?.status ?? "missing",
          attemptId: signed.attemptId,
        },
      },
    );
    throw internalServerError(
      `x402 payment ${paymentId} could not be finalized (status ${record?.status ?? "missing"})`,
    );
  }
  return {
    paymentId,
    attemptId: signed.attemptId,
    paymentHeader: replayHeader.value,
    caip2Network,
    asset,
    // Same spelling that was stored, so a fresh 200 and the replay of that
    // same row cannot disagree about the amount — or the payTo — they report.
    amount: charged.amount,
    payTo: charged.payTo,
  };
}
