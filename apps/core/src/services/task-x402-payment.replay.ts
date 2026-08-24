import { type Prisma, TaskX402PaymentStatus } from "@sokosumi/database";
import {
  normalizeX402PaymentRequiredWithSources,
  X402_MAX_TIMEOUT_SECONDS,
  X402_MIN_TIMEOUT_SECONDS,
  type X402PaymentRequired,
} from "@sokosumi/masumi/schemas";

import {
  conflict,
  internalServerError,
  unprocessableEntity,
} from "@/helpers/error";
import {
  findX402ReadySource,
  type X402ReadySource,
} from "@/helpers/x402-readiness";
import { describeX402PaymentHeader } from "@/helpers/x402-settlement";
import type { TaskX402PaymentSigned } from "@/schemas/x402-payment.schema";
import {
  assertReplayAgentIdentity,
  assertReplayMatchesStoredDemand,
  assertVerifiedReplayReferencesStoredDemand,
  createX402DemandFingerprint,
  pendingReplayHeld,
  requireStoredDemandFingerprint,
  reusedKeyConflict,
  suppliedDemandReproducesStored,
  type X402ReplayVerification,
} from "@/services/task-x402-payment.replay-demand";

/**
 * Replay / idempotency-resolution concern for the coworker x402 pay flow
 * (PR1-SPEC §3.2/§3.7), split from the pay service so the service stays under
 * the file-size ceiling and this security-critical resolution logic has one
 * home with its own tests.
 *
 * It owns every control over WHEN a record may reach the node — how many
 * times (the attempt cap), how long one call may take, and whether another
 * request is already mid-call (the lease) — because those three only make
 * sense against each other. WHAT the replay must match (demand fingerprint,
 * agent identity, catalog re-verification) lives in
 * `task-x402-payment.replay-demand`, split along that evidence boundary.
 */

/**
 * Cap on node `/x402/pay` calls per record (L3). A PENDING record whose node
 * result is ambiguous is replayable with the same idempotencyKey, and each
 * replay re-signs — reserving a new node attempt and decrementing node budget
 * (the node has no idempotency; ticket 011 Q2). A node stuck returning
 * incomplete-200s would let an uncapped retry loop burn budget without bound.
 * Past this many attempts the replay refuses and directs to support, leaving
 * the record PENDING for the reconciler. User funds are always safe.
 */
export const TASK_X402_MAX_SIGN_ATTEMPTS = 5;

/** How long one node `/x402/pay` call may take before it is abandoned. */
export const TASK_X402_SIGN_REQUEST_TIMEOUT_MS = 20_000;

/** Maximum accepted lead of the node clock over Core's clock. */
export const X402_CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Latest instant an authorization from a started sign attempt can remain live.
 * Persisted before the node call, so even a crash leaves a usable operator
 * safety fence. Includes request transit because signing may occur at its
 * end, AND the bounded commit-to-dispatch delay the dispatch guard permits:
 * `signStartedAt` is stamped inside the charge transaction while the request
 * timer starts only after commit, so without that term a dispatch stalled to
 * the guard's limit under the full tolerated clock lead could sign a
 * `validBefore` a few seconds past this fence — and an operator resolve
 * trusting the fence would refund against a still-live authorization.
 */
export function calculateX402SignRiskExpiresAt(
  signStartedAt: Date,
  maxTimeoutSeconds: number,
): Date {
  return new Date(
    signStartedAt.getTime() +
      TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS +
      TASK_X402_SIGN_REQUEST_TIMEOUT_MS +
      maxTimeoutSeconds * 1_000 +
      X402_CLOCK_SKEW_TOLERANCE_MS,
  );
}

/**
 * Longest commit-to-dispatch delay after which a sign attempt must NOT reach
 * the node.
 *
 * Both persisted fences are stamped from `signStartedAt` INSIDE the charge
 * transaction, while the node call and its abort timer start only after
 * commit. Each fence therefore budgets EXACTLY this much commit-to-dispatch
 * slack — the lease via its slack term below, the sign-risk fence via its
 * own explicit term in `calculateX402SignRiskExpiresAt` — and this guard is
 * what makes the budget an invariant rather than an assumption: a dispatch
 * stalled past it is refused outright. No node call was made, so no header
 * exists, the record stays PENDING, and the same-key replay re-stamps fresh
 * fences before its own dispatch. Changing this constant retunes the lease
 * slack and the risk fence with it, by construction.
 */
export const TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS = 10_000;

/**
 * How long a `processingAt` lease is honoured.
 *
 * Derived from the request timeout rather than written as its own number, so
 * the invariant that matters — a lease must outlast the call it covers — is
 * true by construction. If it were shorter, a second request could take over
 * a lease while the first is still at the node, which is the whole race the
 * lease exists to prevent.
 *
 * The slack is the dispatch-delay budget: it absorbs the charge transaction,
 * scheduling delay, and the client teardown after the abort fires — exactly
 * the commit-to-dispatch gap the dispatch guard bounds.
 */
export const TASK_X402_SIGN_LEASE_MS =
  TASK_X402_SIGN_REQUEST_TIMEOUT_MS + TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS;

/**
 * Minimum useful life left when Soko returns a bearer credential.
 *
 * Every accepted demand grants at least X402_MIN_TIMEOUT_SECONDS. Reserving
 * half that minimum prevents handing out a technically live header that will
 * expire before the coworker can deliver it, while preserving half the
 * advertised window for node latency and clock skew. Enforced at BOTH exits:
 * finalize refuses to store a header below the floor
 * (`insufficient_remaining_lifetime`), and the VERIFIED replay refuses to
 * return one, answering the header-expired 409 instead.
 */
export const X402_MIN_REMAINING_VALIDITY_MS =
  (X402_MIN_TIMEOUT_SECONDS * 1000) / 2;

/**
 * Longest possible risk window for a sign attempt when its exact advertised
 * timeout is unavailable (for example while old Core instances still write
 * rows after the sign-risk migration). The operator resolve path uses this
 * against the latest `processingAt`, so a missing or stale per-attempt fence
 * cannot turn a rolling deploy into an early refund of a live authorization.
 */
export const TASK_X402_MAX_SIGN_RISK_MS =
  TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS +
  TASK_X402_SIGN_REQUEST_TIMEOUT_MS +
  X402_MAX_TIMEOUT_SECONDS * 1_000 +
  X402_CLOCK_SKEW_TOLERANCE_MS;

/** Whether a record is currently held by another in-flight sign. */
function isSignLeaseHeld(processingAt: Date | null, now: Date): boolean {
  return (
    processingAt !== null &&
    now.getTime() - processingAt.getTime() < TASK_X402_SIGN_LEASE_MS
  );
}

/** Everything a replay needs; only PENDING re-signing consumes readiness. */
export interface X402ReplayInput extends X402ReplayVerification {
  /**
   * Buy-side readiness, read OUTSIDE the charge transaction. It is
   * configuration (a `SyncMetadata` row a cron rewrites) that the charge
   * re-validates against THIS demand either way, so reading it early costs
   * nothing — and keeping config reads out of the transaction keeps the
   * serializable snapshot short (see the charge-phase comment in the pay
   * service for the full trade).
   */
  readySources?: readonly X402ReadySource[];
}

export type StoredTaskX402Payment = Pick<
  Prisma.TaskX402PaymentGetPayload<Record<string, never>>,
  | "id"
  | "status"
  | "agentId"
  | "caip2Network"
  | "asset"
  | "amount"
  | "payTo"
  | "demandFingerprint"
  | "attemptId"
  | "xPaymentHeader"
  | "validBefore"
  | "failureReason"
  | "signAttemptCount"
  | "processingAt"
>;

export type ChargePhaseOutcome =
  | { kind: "replay_verified"; payment: TaskX402PaymentSigned }
  | {
      kind: "out_of_credits";
      attemptedCredits: number;
      taskOwnerId: string;
      taskEventId: string;
    }
  | {
      kind: "sign";
      paymentId: string;
      taskOwnerId: string;
      /** Set when this request created (and charged) the record just now. */
      chargedNow: boolean;
      /**
       * The in-transaction stamp both persisted fences derive from. The
       * dispatch site compares it against the clock so a commit-to-dispatch
       * stall can never let the node sign past `signRiskExpiresAt`
       * (TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS).
       */
      signStartedAt: Date;
      normalized: X402PaymentRequired;
      /** Exact requirement the v2 resource server expects echoed in `accepted`. */
      sourceRequirement: Readonly<Record<string, unknown>>;
      evmWalletId: string;
      /** Canonical managed-wallet address expected to sign the authorization. */
      evmWalletAddress: string;
      /** The charged demand — what finalize asserts the node signed back. */
      x402Version: 1 | 2;
      caip2Network: string;
      asset: string;
      amount: string;
      payTo: string;
      scheme: string;
      maxTimeoutSeconds: number;
      domainName: string;
      domainVersion: string;
      assetTransferMethod: string | null;
    };

export function normalizeWithSourcesOrThrow(paymentRequired: unknown) {
  const normalized = normalizeX402PaymentRequiredWithSources(paymentRequired);
  if (normalized.isErr()) {
    throw unprocessableEntity(normalized.error);
  }
  return normalized.value;
}

export function buildStoredSignedResponse(
  record: StoredTaskX402Payment,
): TaskX402PaymentSigned {
  if (!record.attemptId || !record.xPaymentHeader) {
    // Not reachable through `resolveExistingPayment`, which answers a
    // header-purged VERIFIED row with its own 409 before getting here (see
    // `x402_payment_header_expired`). It IS still reachable in principle from
    // the finalize path's concurrent-replay branch, if the purge lands between
    // that row's VERIFIED write and the read of it — a ~2 h window the purge
    // cannot enter — and from a genuinely half-written record. Refusing loudly
    // beats replaying a half-record.
    throw internalServerError(
      `Verified x402 payment ${record.id} is missing its signed result`,
    );
  }
  const paymentHeader = describeX402PaymentHeader(record.xPaymentHeader);
  if (paymentHeader.isErr()) {
    throw internalServerError(
      `Verified x402 payment ${record.id} carries an unreadable protocol header`,
    );
  }
  return {
    paymentId: record.id,
    attemptId: record.attemptId,
    paymentHeader: paymentHeader.value,
    caip2Network: record.caip2Network,
    asset: record.asset,
    amount: record.amount,
    payTo: record.payTo,
  };
}

/**
 * Replay handling for an existing (taskId, idempotencyKey) record
 * (PR1-SPEC §3.2/§3.7):
 *
 * - FAILED / REFUNDED → the key is consumed: the original debit was already
 *   compensated (synchronous refund on refusal; reconciler/operator refund
 *   otherwise), so "retry" here would need a fresh charge under a key whose
 *   unique row is terminal — and a replayed request cannot be told apart from
 *   a new intent accidentally reusing a key. 409 with the stored
 *   failureReason; the coworker retries with a NEW key.
 * - VERIFIED → the stored result verbatim; never charge or sign again (a
 *   re-sign would reserve a new node attempt and burn budget, ticket 011 Q2).
 *   Only AFTER the supplied 402 matches the immutable stored tuple — a reused
 *   key never re-targets a stored header to a different agent/demand, while
 *   current catalog state cannot revoke the stored result. Once its validity
 *   window closes — whether or not the purge has cleared the credential yet —
 *   there is nothing usable to hand back: 409
 *   `x402_payment_header_expired`, distinct from both other 409s because
 *   nothing was refunded.
 * - PENDING → the charge is held and the sign outcome was never observed:
 *   re-run the sign against the STORED verified tuple, again only after the
 *   supplied 402 re-verifies to it (see assertReplayMatchesStoredDemand).
 */

const STORED_TASK_X402_PAYMENT_SELECT = {
  id: true,
  status: true,
  agentId: true,
  caip2Network: true,
  asset: true,
  amount: true,
  payTo: true,
  demandFingerprint: true,
  attemptId: true,
  xPaymentHeader: true,
  validBefore: true,
  failureReason: true,
  signAttemptCount: true,
  processingAt: true,
} as const satisfies Record<keyof StoredTaskX402Payment, true>;

function throwConsumedIdempotencyKey(
  status: "FAILED" | "REFUNDED" | string,
  failureReason: string | null,
): never {
  throw conflict(
    `This idempotencyKey was consumed by a ${status.toLowerCase()} x402 payment` +
      `${failureReason ? `: ${failureReason}` : ""}. ` +
      "Its charge was refunded; use a new idempotencyKey for a new payment intent.",
    { kind: "x402_payment_key_consumed" },
  );
}

/**
 * Lock the payment row and return it only while still VERIFIED.
 * Concurrent goodwill refund wins the lock and flips status first → consumed.
 */
async function lockVerifiedTaskX402PaymentForReplay(
  tx: Prisma.TransactionClient,
  snapshot: StoredTaskX402Payment,
): Promise<StoredTaskX402Payment> {
  await tx.$queryRaw`
    SELECT 1 FROM "task_x402_payment" WHERE "id" = ${snapshot.id} FOR UPDATE
  `;
  const locked = await tx.taskX402Payment.findUnique({
    where: { id: snapshot.id },
    select: STORED_TASK_X402_PAYMENT_SELECT,
  });
  if (locked === null) {
    throw internalServerError(
      `Verified x402 payment ${snapshot.id} disappeared under replay lock`,
    );
  }
  if (
    locked.status === TaskX402PaymentStatus.FAILED ||
    locked.status === TaskX402PaymentStatus.REFUNDED
  ) {
    throwConsumedIdempotencyKey(locked.status, locked.failureReason);
  }
  if (locked.status !== TaskX402PaymentStatus.VERIFIED) {
    throw internalServerError(
      `Verified x402 payment ${snapshot.id} left VERIFIED for unexpected status ${locked.status}`,
    );
  }
  return locked;
}

export async function resolveExistingPayment(
  existing: StoredTaskX402Payment,
  input: X402ReplayInput,
  taskOwnerId: string,
  tx: Prisma.TransactionClient,
): Promise<ChargePhaseOutcome> {
  if (
    existing.status === TaskX402PaymentStatus.FAILED ||
    existing.status === TaskX402PaymentStatus.REFUNDED
  ) {
    throwConsumedIdempotencyKey(existing.status, existing.failureReason);
  }

  // Rows written before the fingerprint migration cannot be proven to match
  // any replay. Fail before mutable catalog checks, and never advise a fresh
  // key that could double-charge a still-live authorization.
  requireStoredDemandFingerprint(existing);

  // Identity first, alias-aware: consolidation may have repointed the stored
  // row's agentId to the canonical agent underneath a legitimate replay.
  await assertReplayAgentIdentity(existing, input.agentId, tx);

  if (existing.status === TaskX402PaymentStatus.VERIFIED) {
    // VERIFIED is not immutable: admin goodwill refund flips it to REFUNDED
    // while intentionally leaving `xPaymentHeader` stored (the coworker may
    // already hold a copy). Status is therefore the only gate against
    // re-issuing a settleable header after credits were restored.
    //
    // payTaskX402 resolves terminal rows from an unlocked preflight read so
    // pure replays stay out of the SERIALIZABLE conflict graph. That snapshot
    // can go stale across `assertReplayAgentIdentity`'s DB round-trip. Lock
    // and reload before returning the bearer instrument.
    const verified = await lockVerifiedTaskX402PaymentForReplay(tx, existing);
    assertVerifiedReplayReferencesStoredDemand(verified, input);
    if (
      verified.xPaymentHeader === null ||
      verified.validBefore === null ||
      verified.validBefore.getTime() <=
        Date.now() + X402_MIN_REMAINING_VALIDITY_MS
    ) {
      // Reject once the authorization expires — or once less than the
      // minimum usable life remains, even if the periodic purge has not
      // cleared `xPaymentHeader` yet. A VERIFIED row does NOT imply a
      // returnable header.
      //
      // The floor mirrors finalize's `insufficient_remaining_lifetime` gate:
      // storing a header below it is refused because it cannot survive the
      // coworker's delivery round trip, and RETURNING one below it is no
      // different — the coworker would burn its request on a credential Soko
      // already knows is unusable, then land on this same 409 anyway.
      //
      // Without this branch the replay fell into `buildStoredSignedResponse`
      // and threw a bare 500 — money-safe, but it tells the coworker "Soko is
      // broken, retry" when the truth is "that authorization expired".
      //
      // Deliberately NOT the consumed-key 409: nothing was refunded here. The
      // charge stands, it bought a header, and the header was spendable for
      // its whole window. A new key is a new payment intent, and saying so is
      // the only honest answer left once the credential is unusable.
      throw conflict(
        "This idempotencyKey's x402 authorization has expired (or has too little validity left to deliver) and its payment header is no longer usable. " +
          "The original charge stands; use a new idempotencyKey for a new payment intent.",
        { kind: "x402_payment_header_expired" },
      );
    }
    return {
      kind: "replay_verified",
      payment: buildStoredSignedResponse(verified),
    };
  }

  // Catalog-free proof FIRST: the key-reused 409 below is the only answer on
  // this path that advises a NEW key, so it may rest only on evidence the
  // catalog cannot move — the supplied 402 against the stored fingerprint.
  // Everything after this proof reads mutable catalog state, and its
  // failures hold the charge instead (pendingReplayHeld).
  if (!suppliedDemandReproducesStored(existing, input)) {
    throw reusedKeyConflict("a different payment demand");
  }

  // PENDING re-signing still uses current catalog state because it creates a
  // new node authorization. A terminal VERIFIED replay above does not.
  const verifiedReplay = await assertReplayMatchesStoredDemand(
    existing,
    input,
    tx,
  );
  if (
    createX402DemandFingerprint(
      verifiedReplay.normalized,
      verifiedReplay.sourceRequirement,
    ) !== requireStoredDemandFingerprint(existing)
  ) {
    // The supplied 402 contains the stored demand (proven above), but
    // verification narrowed to a selection-only-differing sibling on the
    // stored pair. Signing it would mint an authorization under terms other
    // than the ones charged — hold instead of signing or burning the key.
    throw pendingReplayHeld(
      existing,
      "verification narrowed to a sibling of the stored demand",
    );
  }

  // PENDING re-sign cap (L3): each replay re-runs the node sign and burns node
  // budget. Past the cap, stop calling the node and direct to support — the
  // held charge stays PENDING behind its sign-risk fence. Checked
  // before the readiness lookup so an exhausted record never reaches the node.
  if (existing.signAttemptCount >= TASK_X402_MAX_SIGN_ATTEMPTS) {
    throw conflict(
      `This x402 payment reached the maximum of ${TASK_X402_MAX_SIGN_ATTEMPTS} sign attempts without a confirmed result. ` +
        "Contact support to reconcile the held charge; do not retry with this idempotencyKey.",
      { kind: "x402_payment_sign_attempts_exhausted" },
    );
  }

  // One sign at a time per record. Letting two same-key requests reach the
  // node concurrently is how a refunded record ends up with a real signed
  // authorization behind it: the first call refuses (the second consumed the
  // budget), refunds and closes the row, and the second then returns a live
  // header the closed row can no longer hold. Checked after the attempt cap
  // so an exhausted record still gets its more specific answer.
  //
  // The caller must retry with the SAME key — a new one would mint a second
  // charge for a payment that may already be signed.
  if (isSignLeaseHeld(existing.processingAt, new Date())) {
    throw conflict(
      "Another request is already signing this x402 payment. " +
        "Wait for it to finish, then retry with the SAME idempotencyKey; a new key would charge twice.",
      { kind: "x402_payment_key_in_flight" },
    );
  }

  if (!input.readySources) {
    throw internalServerError(
      "PENDING x402 replay is missing buy-side readiness configuration",
    );
  }
  const readySource = findX402ReadySource(
    existing.caip2Network,
    existing.asset,
    input.readySources,
  );
  if (!readySource) {
    throw pendingReplayHeld(
      existing,
      `the (${existing.caip2Network}, ${existing.asset}) pair is no longer buy-side ready`,
    );
  }
  const [signedRequirement] = verifiedReplay.normalized.accepts;
  if (!signedRequirement) {
    throw internalServerError(
      "PENDING x402 replay lost its narrowed payment requirement",
    );
  }

  // Count this re-sign AND take the lease now, inside the charge-phase
  // transaction, so both commit before the node is contacted — an ambiguous
  // outcome (timeout) that leaves the record PENDING still burned an attempt,
  // and a same-key request arriving mid-call sees the lease.
  const signStartedAt = new Date();
  await tx.taskX402Payment.update({
    where: { id: existing.id },
    data: {
      signAttemptCount: { increment: 1 },
      processingAt: signStartedAt,
      signRiskExpiresAt: calculateX402SignRiskExpiresAt(
        signStartedAt,
        signedRequirement.maxTimeoutSeconds,
      ),
    },
  });

  // Source-of-truth rule for the charged-demand fields (mirrored by the fresh
  // path in the pay service): fields PERSISTED on the row come from
  // `existing.*` — the stored tuple is the authority finalize asserts against
  // — while fields NOT persisted (scheme, timeout, domain, transfer method)
  // come from the re-verified 402, which the fingerprint check above has
  // proven byte-equal to what was originally charged.
  return {
    kind: "sign",
    paymentId: existing.id,
    taskOwnerId,
    chargedNow: false,
    signStartedAt,
    normalized: verifiedReplay.normalized,
    sourceRequirement: verifiedReplay.sourceRequirement,
    evmWalletId: readySource.evmWalletId,
    evmWalletAddress: readySource.evmWalletAddress,
    x402Version: verifiedReplay.normalized.x402Version,
    caip2Network: existing.caip2Network,
    asset: existing.asset,
    amount: existing.amount,
    payTo: existing.payTo,
    scheme: signedRequirement.scheme,
    maxTimeoutSeconds: signedRequirement.maxTimeoutSeconds,
    domainName: verifiedReplay.domainName,
    domainVersion: verifiedReplay.domainVersion,
    assetTransferMethod: signedRequirement.extra?.assetTransferMethod ?? null,
  };
}
