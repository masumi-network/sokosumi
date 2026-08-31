import {
  type Prisma,
  TaskX402PaymentRefundKind,
  TaskX402PaymentStatus,
} from "@sokosumi/database";

import { buildCompensatingRefundTransactionCreate } from "@/helpers/compensating-refund";
import prisma from "@/lib/db/prisma";
import type {
  RefundAdminTaskX402PaymentBody,
  ResolveAdminTaskX402PaymentBody,
} from "@/schemas/admin-task-x402-payment.schema";
import {
  TASK_X402_MAX_SIGN_RISK_MS,
  TASK_X402_SIGN_LEASE_MS,
} from "@/services/task-x402-payment.replay";

/**
 * The CODED reasons a refused x402 payment may be marked FAILED with.
 *
 * `failureReason` is not an internal log field: `resolveExistingPayment`
 * embeds it verbatim in the consumed-key 409 the coworker gets on the next
 * request with the same idempotencyKey. Persisting the node's raw refusal
 * text there would re-leak exactly what the sanitized 502 withholds — a node
 * 402 reads like `insufficient budget on wallet 0x… remaining 812345` — so
 * one extra request would defeat that control. The raw text is captured to
 * Sentry at the refusal site instead, where operators (not callers) read it,
 * and nothing operational is lost.
 *
 * A closed set, not free text: anything durable enough to be handed back to
 * an untrusted caller has to be a value someone chose deliberately.
 */
export const TASK_X402_FAILURE_REASONS = {
  /**
   * Node 400: a deterministic pre-sign rejection of the forwarded 402 (bad
   * accepts, requirements drift, identifier not advertised). The coworker's
   * own payload is the problem, so the immediate 400 response stays verbose —
   * but what is STORED is still the code, because the store is replayed.
   */
  NODE_REFUSED_PAYLOAD: "node_refused_payload",
  /**
   * Node 402/500 (or any other non-200): budget/balance exhaustion or a node
   * config/signing failure. Soko-side operational trouble whose detail is
   * never the caller's business.
   */
  NODE_REFUSED_OPERATIONAL: "node_refused_operational",
} as const;

export type TaskX402FailureReason =
  (typeof TASK_X402_FAILURE_REASONS)[keyof typeof TASK_X402_FAILURE_REASONS];

/**
 * Classifies a node refusal into a coded {@link TASK_X402_FAILURE_REASONS}
 * value from its HTTP status alone. 400 is the one status that is provably
 * about the forwarded payload; everything else is operational.
 */
export function classifyNodeRefusal(status?: number): TaskX402FailureReason {
  return status === 400
    ? TASK_X402_FAILURE_REASONS.NODE_REFUSED_PAYLOAD
    : TASK_X402_FAILURE_REASONS.NODE_REFUSED_OPERATIONAL;
}

/** The one status an operator goodwill refund may compensate (PR1-SPEC §5). */
const ADMIN_REFUNDABLE_STATUS = TaskX402PaymentStatus.VERIFIED;

/**
 * The one status the operator resolve lever may compensate. Deliberately NOT
 * VERIFIED: that row carries a live header which may still settle, and only
 * the goodwill refund may reverse it, deliberately.
 */
const ADMIN_RESOLVABLE_STATUS = TaskX402PaymentStatus.PENDING;
const TASK_X402_SYSTEM_ACTOR_ID = "system:x402";

interface RefundablePayment {
  id: string;
  transaction: {
    amount: bigint;
    userId: string | null;
    organizationId: string | null;
  };
}

function requireSpendUserId(userId: string | null, context: string): string {
  if (userId === null) {
    throw new Error(`${context} spend transaction is missing userId`);
  }
  return userId;
}

/**
 * What both operator levers read: the discriminators that explain a lost claim
 * (`status`, `refundTransactionId`, `processingAt`) plus every money fact the
 * FK-free audit row must carry. Selected inside the claiming transaction so
 * the snapshot cannot disagree with the claim it explains.
 */
const OPERATOR_ACTION_SELECT = {
  id: true,
  transactionId: true,
  status: true,
  refundTransactionId: true,
  processingAt: true,
  signRiskExpiresAt: true,
  signAttemptCount: true,
  taskId: true,
  agentId: true,
  amount: true,
  asset: true,
  caip2Network: true,
  transaction: {
    select: {
      amount: true,
      userId: true,
      organizationId: true,
    },
  },
} satisfies Prisma.TaskX402PaymentSelect;

type OperatorActionPayment = Prisma.TaskX402PaymentGetPayload<{
  select: typeof OPERATOR_ACTION_SELECT;
}>;

/**
 * Writes one append-only, FK-free payment outcome row.
 *
 * Denormalized snapshot: the row is FK-free and outlives the hard-delete of
 * the payment, so every money fact it needs to stay readable as evidence is
 * copied in at write time. Snapshot columns added after this ledger first
 * shipped remain nullable only so old rows can survive; every new writer fills
 * them before the source payment can be erased.
 *
 * Operator actions use their User.id. Automated refusal uses a stable system
 * actor so this writer remains compatible with databases where operatorId is
 * already NOT NULL during a rolling migration.
 */
async function writePaymentOutcomeAudit(
  tx: Prisma.TransactionClient,
  input: {
    payment: OperatorActionPayment;
    /** The vocabulary reserved by the schema doc comment. */
    action: "failure" | "refund" | "resolve";
    operatorId: string;
    refundTransactionId: string;
    reason:
      | TaskX402FailureReason
      | RefundAdminTaskX402PaymentBody["reason"]
      | ResolveAdminTaskX402PaymentBody["reason"];
  },
): Promise<void> {
  const { payment, action, operatorId, reason, refundTransactionId } = input;
  // The debit is stored NEGATIVE (createTaskEventTransaction: `input.cents *
  // -1n`) while this column records the magnitude the operator moved. Take
  // the magnitude rather than negating, for the same reason the admin list
  // does when deriving `creditsCharged`.
  const debitCents =
    payment.transaction.amount < 0n
      ? -payment.transaction.amount
      : payment.transaction.amount;
  const data = {
    paymentId: payment.id,
    action,
    operatorId,
    reason,
    cents: debitCents,
    amount: payment.amount,
    asset: payment.asset,
    caip2Network: payment.caip2Network,
    taskId: payment.taskId,
    agentId: payment.agentId,
    chargedUserId: requireSpendUserId(
      payment.transaction.userId,
      `Task x402 payment ${payment.id}`,
    ),
    chargedOrganizationId: payment.transaction.organizationId,
    chargeTransactionId: payment.transactionId,
    refundTransactionId,
  };
  if (action === "failure") {
    // Forward migration installs a DB trigger so old and new binaries both
    // produce this durable outcome during rolling deploys. The partial unique
    // index makes app + trigger converge on one row.
    await tx.taskX402PaymentAction.createMany({
      data: [data],
      skipDuplicates: true,
    });
    return;
  }
  await tx.taskX402PaymentAction.create({ data });
}

/**
 * Restores a payment's full debit as a non-expiring REFUND bucket, atomically,
 * by attaching a compensating refund transaction to the record. Shared by the
 * automated refusal refund and both operator levers so all three mint the exact
 * same refund shape (mirrors refundFailedTaskPaymentClaim).
 *
 * KNOWN TRIPLICATION: the nested refund-transaction + REFUND-bucket stamp
 * now lives in `buildCompensatingRefundTransactionCreate`. Remaining local
 * duplication is parent attach, referenceId, and refundKind, not bucket
 * ownership.
 *
 * Non-expiring: the debit may have consumed expiring buckets, and a payment
 * Sokosumi refunds must not cost the user credits that expire before they can
 * be spent again.
 *
 * `kind` is mandatory and is written in THIS update, beside the refund it
 * labels. Every refund in the system is minted here, so a caller cannot mint
 * one without saying which lever it was, and the label cannot be written by a
 * later statement that a rollback or a new code path might skip. The admin
 * rollup's headline quality signal reads this column: a resolve counted as a
 * goodwill refund falsely ranks a healthy agent as quality-bleeding.
 */
async function attachCompensatingRefund(
  tx: Prisma.TransactionClient,
  payment: RefundablePayment,
  kind: TaskX402PaymentRefundKind,
): Promise<string> {
  const refundAmount = payment.transaction.amount * -1n;
  if (refundAmount <= 0n) {
    throw new Error(`Task x402 payment ${payment.id} has no debit to refund`);
  }

  const updatedPayment = await tx.taskX402Payment.update({
    where: { id: payment.id },
    data: {
      refundKind: kind,
      refundTransaction: {
        create: buildCompensatingRefundTransactionCreate({
          amount: refundAmount,
          actorUserId: requireSpendUserId(
            payment.transaction.userId,
            `Task x402 payment ${payment.id}`,
          ),
          organizationId: payment.transaction.organizationId,
          referenceId: `task-x402-payment:${payment.id}`,
        }),
      },
    },
    select: { refundTransactionId: true },
  });
  if (!updatedPayment.refundTransactionId) {
    throw new Error(
      `Task x402 payment ${payment.id} refund transaction was not attached`,
    );
  }
  return updatedPayment.refundTransactionId;
}

/**
 * Compensates a node-refused x402 payment: FAILED + the full debit restored
 * as a non-expiring refund bucket, atomically. Repeated calls are no-ops after
 * the first refund. Safe only for the record's first sign attempt: that
 * refusal means no header was ever issued (ticket 011 Q1), so nothing can
 * settle. A replay refusal does not prove an earlier ambiguous attempt safe and
 * remains PENDING behind its risk fence. NEVER refunds a VERIFIED record: that
 * row carries a live header, so the automated path refuses it (only the
 * operator goodwill lever below may compensate a VERIFIED payment).
 *
 * Split from the pay flow by responsibility: the admin surface (PR1-SPEC §5)
 * grows its operator refund next to this seam, not inside the pay service.
 */
export async function refundRefusedTaskX402Payment(
  paymentId: string,
  failureReason: TaskX402FailureReason,
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const claimed = await tx.taskX402Payment.updateMany({
      // `refundTransactionId: null` for the same reason both operator levers
      // carry it: an occupied optional one-to-one does not make the nested
      // create in attachCompensatingRefund fail, it re-points the FK, so
      // status alone would let this path mint a second refund and orphan the
      // first. Unreachable through app code; the invariant belongs in the
      // predicate anyway.
      where: {
        id: paymentId,
        status: TaskX402PaymentStatus.PENDING,
        refundTransactionId: null,
        // Only the first sign attempt can be proven safe from this refusal
        // alone. A replay means an earlier attempt ended ambiguously and may
        // have produced an authorization which is still settleable even though
        // the CURRENT node call returned a documented refusal.
        signAttemptCount: 1,
      },
      data: {
        // Stored verbatim: the type is a closed set of short codes, so there
        // is nothing to truncate and nothing caller-authored to bound.
        status: TaskX402PaymentStatus.FAILED,
        failureReason,
      },
    });

    const payment = await tx.taskX402Payment.findUnique({
      where: { id: paymentId },
      select: OPERATOR_ACTION_SELECT,
    });
    if (!payment) {
      throw new Error(`Task x402 payment ${paymentId} not found`);
    }
    if (claimed.count === 0) {
      if (
        (payment.status === TaskX402PaymentStatus.FAILED ||
          payment.status === TaskX402PaymentStatus.REFUNDED) &&
        payment.refundTransactionId !== null
      ) {
        return false;
      }
      if (payment.status === TaskX402PaymentStatus.VERIFIED) {
        throw new Error(
          `Task x402 payment ${paymentId} is already verified; refusing to refund a live header`,
        );
      }
      if (
        payment.status === TaskX402PaymentStatus.PENDING &&
        payment.signAttemptCount > 1
      ) {
        throw new Error(
          `Task x402 payment ${paymentId} has an earlier ambiguous sign attempt; refusing to refund until its authorization-risk window expires`,
        );
      }
      if (payment.refundTransactionId !== null) {
        // Not the already-compensated no-op above: a non-terminal row holding a
        // refund is an anomaly no code path produces. Hold it and page.
        throw new Error(
          `Task x402 payment ${paymentId} already carries a compensating refund in status ${payment.status}; refusing to mint a second one`,
        );
      }
      throw new Error(
        `Task x402 payment ${paymentId} could not be refunded (status ${payment.status})`,
      );
    }

    const refundTransactionId = await attachCompensatingRefund(
      tx,
      payment,
      TaskX402PaymentRefundKind.NODE_REFUSAL,
    );
    await writePaymentOutcomeAudit(tx, {
      payment,
      action: "failure",
      operatorId: TASK_X402_SYSTEM_ACTOR_ID,
      refundTransactionId,
      reason: failureReason,
    });
    return true;
  });
}

export interface AdminRefundTaskX402PaymentInput {
  paymentId: string;
  operatorId: string;
  reason: RefundAdminTaskX402PaymentBody["reason"];
}

/**
 * Outcome of an operator goodwill refund. Only `refunded` moved money; the
 * route maps the rest to 404/409.
 */
export type AdminRefundTaskX402PaymentResult =
  | { status: "refunded"; paymentId: string; reason: string; compensated: true }
  | { status: "already_refunded" }
  | { status: "not_refundable"; reason: string }
  | { status: "not_found" };

/**
 * Operator goodwill / support-driven refund (PR1-SPEC §5). Compensates a
 * VERIFIED payment — the "paid but bad result" case — flipping it to REFUNDED,
 * minting the compensating refund, and writing an append-only
 * `TaskX402PaymentAction` audit row, all atomically. Idempotent: a second call
 * on an already-refunded record claims nothing and returns `already_refunded`,
 * so no double refund is ever minted. Mirrors the admin claim refund's guards
 * and its action-audit write.
 *
 * Refundable statuses (documented, PR1-SPEC §5):
 *   - VERIFIED → yes (the goodwill target; Soko accepts the node-side cost of a
 *     header the coworker may already hold — the credits go back regardless).
 *   - FAILED   → already compensated by the atomic refusal refund → 409.
 *   - REFUNDED → already refunded → 409.
 *   - PENDING  → blocked: the crash window is resolved by coworker replay or
 *     the (unbuilt) reconciler, never an admin refund → 409.
 *
 * The live `xPaymentHeader` is intentionally left stored: nulling Sokosumi's
 * copy would not revoke the coworker's copy, and the reconciler NULLs it at
 * `validBefore` expiry.
 */
export async function refundVerifiedTaskX402Payment(
  input: AdminRefundTaskX402PaymentInput,
): Promise<AdminRefundTaskX402PaymentResult> {
  const { paymentId, operatorId, reason } = input;

  return await prisma.$transaction(async (tx) => {
    // Claim VERIFIED → REFUNDED atomically so a concurrent admin refund or a
    // reconciler transition can only win once.
    //
    // `refundTransactionId: null` is part of the claim, not a downstream check.
    // Nothing else stops a second refund on a row that somehow already has one:
    // `attachCompensatingRefund`'s nested create does NOT fail on an occupied
    // optional one-to-one — Prisma re-points the FK, so the lever would mint a
    // second refund transaction and a second non-expiring REFUND bucket, orphan
    // the first, and write an audit row claiming one compensation. Unreachable
    // through app code today (the refund id is only ever set in the same
    // transaction as a terminal status flip, and nothing writes PENDING back),
    // but the invariant belongs in the predicate that guards the money.
    const claimed = await tx.taskX402Payment.updateMany({
      where: {
        id: paymentId,
        status: ADMIN_REFUNDABLE_STATUS,
        refundTransactionId: null,
      },
      data: { status: TaskX402PaymentStatus.REFUNDED },
    });

    const payment = await tx.taskX402Payment.findUnique({
      where: { id: paymentId },
      select: OPERATOR_ACTION_SELECT,
    });
    if (!payment) {
      return { status: "not_found" };
    }

    if (claimed.count === 0) {
      if (
        (payment.status === TaskX402PaymentStatus.FAILED ||
          payment.status === TaskX402PaymentStatus.REFUNDED) &&
        payment.refundTransactionId !== null
      ) {
        return { status: "already_refunded" };
      }
      if (payment.status === ADMIN_REFUNDABLE_STATUS) {
        // The status matched, so the refund predicate is what refused: the row
        // is VERIFIED and already carries a compensating refund. Say that,
        // rather than the final branch's self-contradicting "cannot be refunded
        // in status VERIFIED" — this needs a human, not a retry.
        return {
          status: "not_refundable",
          reason:
            "Payment is verified but already carries a compensating refund; refunding again would mint a second one. Investigate the record before acting",
        };
      }
      if (payment.status === TaskX402PaymentStatus.PENDING) {
        return {
          status: "not_refundable",
          reason:
            "Payment is pending; it is resolved by coworker replay or the reconciler, not an admin refund",
        };
      }
      return {
        status: "not_refundable",
        reason: `Payment cannot be refunded in status ${payment.status}`,
      };
    }

    const refundTransactionId = await attachCompensatingRefund(
      tx,
      payment,
      TaskX402PaymentRefundKind.OPERATOR_GOODWILL,
    );
    await writePaymentOutcomeAudit(tx, {
      payment,
      action: "refund",
      operatorId,
      reason,
      refundTransactionId,
    });

    return {
      status: "refunded",
      paymentId,
      reason: `Administrator ${operatorId} refunded x402 payment: ${reason}`,
      compensated: true,
    };
  });
}

export interface AdminResolveTaskX402PaymentInput {
  paymentId: string;
  operatorId: string;
  reason: ResolveAdminTaskX402PaymentBody["reason"];
}

/**
 * Outcome of an operator resolve. Only `resolved` moved money; the route maps
 * the rest to 404/409.
 */
export type AdminResolveTaskX402PaymentResult =
  | { status: "resolved"; paymentId: string; reason: string; compensated: true }
  | { status: "already_resolved" }
  | {
      status: "sign_in_flight";
      reason: string;
      /** ISO instant after which the lease is expired and a retry can claim. */
      retryAfter: string;
      retryAfterSeconds: number;
    }
  | {
      status: "sign_outcome_unresolved";
      reason: string;
      retryAfter: string;
      retryAfterSeconds: number;
    }
  | { status: "not_resolvable"; reason: string }
  | { status: "not_found" };

/**
 * Operator resolve of a wedged PENDING x402 payment: claims PENDING →
 * REFUNDED, mints the compensating refund, and writes a `"resolve"` audit row,
 * all atomically. Idempotent — a second call claims nothing and returns
 * `already_resolved`, so no double refund is ever minted.
 *
 * WHEN REFUNDING A PENDING ROW IS SAFE. A row is PENDING only on paths where
 * the coworker never received a usable `X-PAYMENT` header:
 *   - node refused (any non-200) → the row is FAILED, not PENDING;
 *   - malformed / unreadable / ambiguous 200 → the coworker got a 502 and no
 *     header, and the record was never written VERIFIED;
 *   - signed tuple did not match the charged demand → Soko received a valid
 *     header, deliberately discarded it, and returned 502;
 *   - crash or timeout before/inside the node call → nothing was signed, or
 *     the result never reached anyone.
 * Soko or the node may nevertheless have produced and discarded a live
 * authorization. Every sign attempt therefore persists a conservative
 * `signRiskExpiresAt` before contacting the node. Resolution is safe only
 * after both the active lease and that possible authorization window expire.
 *
 * WHY IT EXISTS. `prepareTasksForUserDeletion` blocks account deletion on any
 * PENDING x402 payment. Coworker replay exhausts TASK_X402_MAX_SIGN_ATTEMPTS
 * and never resets, the settlement reconciler is not built in this stack, and
 * the goodwill refund only claims VERIFIED — so without this lever a wedged
 * PENDING row blocks a GDPR erasure request forever, with no operator remedy.
 *
 * WHY IT REFUSES A LEASED ROW. An unexpired `processingAt` means a node
 * round-trip is in flight: the row is not wedged, it is being worked, and it
 * will leave PENDING on its own within the lease. Claiming it is not a
 * double-refund risk (the finalize claims `status: PENDING` and would lose the
 * race), but it manufactures exactly the state the pay flow calls the worst it
 * can reach — a signed EIP-3009 authorization Soko discards after closing the
 * row — and pages ops at error level for an action an operator took on
 * purpose. The lease is short and self-expiring, so waiting it out costs the
 * operator seconds and buys a definite status.
 *
 * Resolvable statuses:
 *   - PENDING, no live lease or sign risk → yes (the wedged-row target).
 *   - PENDING, lease held                → retry after lease expiry.
 *   - PENDING, sign risk live            → retry after risk expiry.
 *   - VERIFIED               → never: a live header may still settle, and only
 *                              the goodwill refund may reverse that.
 *   - FAILED / REFUNDED      → already compensated → already_resolved.
 */
export async function resolvePendingTaskX402Payment(
  input: AdminResolveTaskX402PaymentInput,
): Promise<AdminResolveTaskX402PaymentResult> {
  const { paymentId, operatorId, reason } = input;

  return await prisma.$transaction(async (tx) => {
    // Claim PENDING → REFUNDED atomically so a concurrent resolve, goodwill
    // refund, refusal refund, or sign finalize can only win once. The lease is
    // part of the predicate rather than a read-then-check, so a sign that
    // takes the lease between the read and the write still blocks the claim.
    //
    // `refundTransactionId: null` is in the predicate for the same reason it is
    // in the goodwill lever's — see there. An occupied optional one-to-one does
    // not make the nested create fail; it re-points the FK.
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - TASK_X402_SIGN_LEASE_MS);
    const conservativeRiskCutoff = new Date(
      now.getTime() - TASK_X402_MAX_SIGN_RISK_MS,
    );
    const claimed = await tx.taskX402Payment.updateMany({
      where: {
        id: paymentId,
        status: ADMIN_RESOLVABLE_STATUS,
        refundTransactionId: null,
        AND: [
          // Deliberately no null arm. A PENDING payment without a latest
          // attempt timestamp cannot prove when any authorization died.
          { processingAt: { lte: conservativeRiskCutoff } },
          {
            OR: [
              { signRiskExpiresAt: null },
              { signRiskExpiresAt: { lte: now } },
            ],
          },
        ],
      },
      data: { status: TaskX402PaymentStatus.REFUNDED },
    });

    const payment = await tx.taskX402Payment.findUnique({
      where: { id: paymentId },
      select: OPERATOR_ACTION_SELECT,
    });
    if (!payment) {
      return { status: "not_found" };
    }

    if (claimed.count === 0) {
      if (
        (payment.status === TaskX402PaymentStatus.FAILED ||
          payment.status === TaskX402PaymentStatus.REFUNDED) &&
        payment.refundTransactionId !== null
      ) {
        return { status: "already_resolved" };
      }
      if (payment.status === ADMIN_RESOLVABLE_STATUS) {
        if (payment.refundTransactionId !== null) {
          // A PENDING row that already carries a refund. NOT "already
          // compensated": the row is still PENDING, so it still blocks account
          // deletion and the operator would be left with a dead end. Name the
          // anomaly instead — resolving it would mint a second refund.
          return {
            status: "not_resolvable",
            reason:
              "Payment is pending but already carries a compensating refund; resolving it would mint a second one. Investigate the record before acting",
          };
        }
        if (payment.processingAt === null) {
          return {
            status: "not_resolvable",
            reason:
              "Payment is pending but has no sign-attempt timestamp; its authorization lifetime cannot be proven. Investigate the record before refunding",
          };
        }
        if (payment.processingAt.getTime() > leaseCutoff.getTime()) {
          const leaseExpiresAt = new Date(
            payment.processingAt.getTime() + TASK_X402_SIGN_LEASE_MS,
          );
          const retryAfter = leaseExpiresAt.toISOString();
          const retryAfterSeconds = Math.max(
            0,
            Math.ceil((leaseExpiresAt.getTime() - Date.now()) / 1_000),
          );
          return {
            status: "sign_in_flight",
            reason:
              `Another request is signing this x402 payment; its sign lease expires at ${retryAfter}. ` +
              `Retry the resolve after that (about ${retryAfterSeconds}s) — the record may finalize on its own first.`,
            retryAfter,
            retryAfterSeconds,
          };
        }
        const conservativeRiskExpiresAt = new Date(
          payment.processingAt.getTime() + TASK_X402_MAX_SIGN_RISK_MS,
        );
        const effectiveRiskExpiresAt =
          payment.signRiskExpiresAt !== null &&
          payment.signRiskExpiresAt > conservativeRiskExpiresAt
            ? payment.signRiskExpiresAt
            : conservativeRiskExpiresAt;
        if (effectiveRiskExpiresAt.getTime() > Date.now()) {
          const retryAfter = effectiveRiskExpiresAt.toISOString();
          const retryAfterSeconds = Math.max(
            0,
            Math.ceil((effectiveRiskExpiresAt.getTime() - Date.now()) / 1_000),
          );
          return {
            status: "sign_outcome_unresolved",
            reason:
              `This payment has an unresolved sign outcome; a discarded authorization may remain live until ${retryAfter}. ` +
              `Retry the resolve after that (about ${retryAfterSeconds}s).`,
            retryAfter,
            retryAfterSeconds,
          };
        }
        return {
          status: "not_resolvable",
          reason:
            "Payment changed while its resolution was being claimed. Reload the record and retry",
        };
      }
      if (payment.status === TaskX402PaymentStatus.VERIFIED) {
        return {
          status: "not_resolvable",
          reason:
            "Payment is verified; its X-PAYMENT header may still settle, so only the goodwill refund may reverse it",
        };
      }
      return {
        status: "not_resolvable",
        reason: `Payment cannot be resolved in status ${payment.status}`,
      };
    }

    const refundTransactionId = await attachCompensatingRefund(
      tx,
      payment,
      TaskX402PaymentRefundKind.OPERATOR_RESOLVE,
    );
    await writePaymentOutcomeAudit(tx, {
      payment,
      action: "resolve",
      operatorId,
      reason,
      refundTransactionId,
    });

    return {
      status: "resolved",
      paymentId,
      reason: `Administrator ${operatorId} resolved pending x402 payment: ${reason}`,
      compensated: true,
    };
  });
}
