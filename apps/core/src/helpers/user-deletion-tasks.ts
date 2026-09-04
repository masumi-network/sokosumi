import * as Sentry from "@sentry/node";
import {
  TaskPaymentClaimStatus,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
import type { createPrismaClient } from "@sokosumi/database/client";
import { APIError } from "better-auth/api";

import { isPrismaTransactionConflict } from "@/helpers/prisma";
import { deleteTaskFileIfOwned } from "@/lib/blob";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * The statuses the sweep below may hard-delete. Kept as one list so the
 * unresolved-payment guard (`notIn`) and the sweep (`in`) can never disagree:
 * anything outside this list blocks deletion, fail-closed. When the enum
 * grows (the planned EXPIRED_UNUSED, say), a row in the new status blocks the
 * deletion and pages ops until this code learns whether it is sweepable —
 * instead of being silently destroyed while it may still represent money in
 * flight, or leaking past the sweep into a raw RESTRICT-FK 500.
 */
export const SWEEPABLE_X402_STATUSES = [
  TaskX402PaymentStatus.VERIFIED,
  TaskX402PaymentStatus.FAILED,
  TaskX402PaymentStatus.REFUNDED,
];

/**
 * Clear creator RESTRICT blockers and delete the user in one transaction.
 *
 * - Owned tasks are deleted (owner cascade would anyway).
 * - Tasks this user (or their assigned coworkers) created but do not own keep the
 *   row and re-point creator to the task owner as a user creator.
 * - Coworker assignments cascade-delete with the user; creatorCoworkerId is
 *   RESTRICT, so those refs must be cleared first.
 * - Payment-claim blockers are previewed by `evaluateUserDeletion` and
 *   re-checked here under lock. Terminal claims are removed so their RESTRICT
 *   transaction relations do not block user cascade.
 * - Pending x402 payments block deletion: their debit must survive so support
 *   can compensate it. The admin resolve lever
 *   (`POST /v1/admin/task-x402-payments/{id}/resolve`) bounds the block by an
 *   operator's response time, so the guard pages ops with that endpoint and
 *   routes the user to support. A payment in a status this code does not
 *   recognize blocks the same way, fail-closed, instead of being swept. A
 *   signed payment whose bearer authorization may still settle also blocks
 *   deletion until expiry or header purge, including a goodwill-refunded
 *   payment whose header remains live. Known-terminal x402 payments are
 *   removed because their RESTRICT task and transaction relations would
 *   otherwise block both the owned-task delete and the user cascade. A swept
 *   payment whose charge belongs to another user blocks deletion and pages
 *   Sentry — it means Task.ownerId was not the billing owner, and repair is
 *   manual (no admin endpoint changes payment ownership).
 * - Chat rooms this user created re-point `createdByUserId` to another remaining
 *   human member. Rooms with no other human member are deleted so Restrict does
 *   not 500 an allowed wipe.
 * - Public blob files for owned tasks are best-effort deleted after the DB
 *   cascade (URLs remain public if blob GC fails).
 */
export async function prepareTasksForUserDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<void> {
  let ownedTaskFiles: Array<{ fileUrl: string | null; taskId: string }>;
  try {
    ownedTaskFiles = await prisma.$transaction(
      async (tx) => {
        // Serialize account deletion with both halves of x402 payment creation:
        //
        // 0. Every debit Transaction insert takes a foreign-key key-share lock
        //    on its User. Lock and ultimately delete that User in THIS
        //    transaction, rather than returning to Better Auth between cleanup
        //    and deletion. A charge already in flight completes before these
        //    reads; a later charge waits and then finds no billing user.
        //
        // 1. A new payment must acquire a foreign-key key-share lock on its Task.
        //    Holding FOR UPDATE on every owned task therefore makes a concurrent
        //    charge wait until deletion either aborts or removes the task.
        // 2. A sign finalize / operator action updates an existing payment row.
        //    Lock every payment the sweep can reach before checking PENDING/live
        //    status, so that status cannot change between the checks and delete.
        //
        // Keep READ COMMITTED rather than a fixed SERIALIZABLE snapshot. If a
        // payment transaction already held the task key-share lock, this first
        // statement waits for it and the following payment query must see what it
        // committed. A fixed earlier snapshot could miss that newly committed
        // child and fall into a late foreign-key failure instead.
        await tx.$queryRaw`
          SELECT "id"
          FROM "user"
          WHERE "id" = ${userId}
          FOR UPDATE
        `;
        await tx.$queryRaw`
          SELECT "id"
          FROM "task"
          WHERE "ownerId" = ${userId}
          FOR UPDATE
        `;
        // Three UNIONed arms rather than one join with an OR across charge,
        // refund and task: a disjunction whose branches live in three different
        // joined relations cannot be served by any index, so the single-query
        // form had to build and filter the full payments join on every account
        // deletion — while holding the user and task locks above. Each arm here
        // seeks (Transaction has a userId-leading index, task has ownerId, and
        // the payment side is reached over its transactionId/refundTransactionId
        // uniques and the taskId unique prefix). Only the outer SELECT takes
        // locks, exactly like FOR UPDATE OF payment did on the join.
        await tx.$queryRaw`
          SELECT payment."id"
          FROM "task_x402_payment" AS payment
          WHERE payment."id" IN (
            SELECT charge_payment."id"
            FROM "task_x402_payment" AS charge_payment
            INNER JOIN "Transaction" AS charge
              ON charge."id" = charge_payment."transactionId"
            WHERE charge."userId" = ${userId}
            UNION
            SELECT refund_payment."id"
            FROM "task_x402_payment" AS refund_payment
            INNER JOIN "Transaction" AS refund
              ON refund."id" = refund_payment."refundTransactionId"
            WHERE refund."userId" = ${userId}
            UNION
            SELECT task_payment."id"
            FROM "task_x402_payment" AS task_payment
            INNER JOIN "task" AS payment_task
              ON payment_task."id" = task_payment."taskId"
            WHERE payment_task."ownerId" = ${userId}
          )
          FOR UPDATE OF payment
        `;

        // Prefer review-required claims over ordinary PENDING ones. A single
        // findFirst without that filter is nondeterministic when both exist, and
        // would return TASK_PAYMENT_CLAIM_PENDING without paging Sentry for the
        // operator-blocked row.
        const reviewRequiredClaim = await tx.taskPaymentClaim.findFirst({
          where: {
            status: TaskPaymentClaimStatus.PENDING,
            reviewRequiredAt: { not: null },
            transaction: { userId },
          },
          select: { id: true, reviewRequiredAt: true },
        });
        if (reviewRequiredClaim?.reviewRequiredAt) {
          // A plain PENDING claim clears itself within a cron cycle, but one
          // parked for review clears only when an operator resolves it — so
          // this branch is an account deletion blocked for an unbounded time by
          // an internal queue. Page it: the user cannot unblock themselves, and
          // the admin resolve/refund endpoints are the only way out.
          Sentry.captureMessage(
            "Account deletion blocked by a task payment claim awaiting review",
            {
              level: "error",
              tags: { error_type: "user_deletion_blocked_by_claim_review" },
              extra: {
                userId,
                taskPaymentClaimId: reviewRequiredClaim.id,
                reviewRequiredAt:
                  reviewRequiredClaim.reviewRequiredAt.toISOString(),
              },
            },
          );
          throw new APIError("BAD_REQUEST", {
            code: "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
            message:
              "A task payment needs administrator review before your account can be deleted. Please contact support.",
          });
        }

        const pendingPaymentClaim = await tx.taskPaymentClaim.findFirst({
          where: {
            status: TaskPaymentClaimStatus.PENDING,
            transaction: { userId },
          },
          select: { id: true },
        });
        if (pendingPaymentClaim) {
          throw new APIError("BAD_REQUEST", {
            code: "TASK_PAYMENT_CLAIM_PENDING",
            message:
              "Wait for pending task payments to settle before deleting your account.",
          });
        }

        await tx.taskPaymentClaim.deleteMany({
          where: {
            status: {
              in: [
                TaskPaymentClaimStatus.PURCHASED,
                TaskPaymentClaimStatus.REFUNDED,
              ],
            },
            OR: [
              { transaction: { userId } },
              { refundTransaction: { userId } },
            ],
          },
        });

        // Any x402 payment NOT in a known-terminal status blocks deletion.
        // For PENDING: the row holds a debit the user cannot clear themselves —
        // no reconciler exists in this stack, and coworker replay stops at the
        // sign-attempt cap. Support clears it with the admin resolve lever
        // (`POST /v1/admin/task-x402-payments/{id}/resolve`, which claims PENDING →
        // REFUNDED and mints the compensating refund), so this block is bounded by
        // an operator's response time rather than by an unbuilt component. Page ops
        // with the exact endpoint and route the user to support. The task-owner
        // branch matters because taskId is RESTRICT: a pending payment on an owned
        // task blocks the owned-task delete below regardless of who was charged.
        // For any FUTURE status this code predates: fail closed the same way
        // (see SWEEPABLE_X402_STATUSES) instead of letting the sweep destroy a
        // row whose semantics this code cannot know.
        const unresolvedX402Payment = await tx.taskX402Payment.findFirst({
          where: {
            status: { notIn: SWEEPABLE_X402_STATUSES },
            // refundTransaction should be impossible on a non-terminal row (the
            // refund is written when status flips), but nothing DB-level forbids
            // it and the FK is RESTRICT — without this branch such a row would
            // fail the user cascade with a raw FK 500 instead of this clean 400.
            OR: [
              { transaction: { userId } },
              { refundTransaction: { userId } },
              { task: { ownerId: userId } },
            ],
          },
          select: { id: true, status: true },
        });
        if (unresolvedX402Payment) {
          // The user cannot unblock themselves — nothing auto-refunds the held
          // debit, so only an operator can. Page it the same way a review-required
          // claim is paged, and carry the endpoint that clears it: whoever this
          // wakes should not have to go find out which lever to pull, and this is
          // a GDPR erasure request stalled until they do.
          if (unresolvedX402Payment.status === TaskX402PaymentStatus.PENDING) {
            Sentry.captureMessage(
              "Account deletion blocked by a pending x402 task payment",
              {
                level: "error",
                tags: { error_type: "user_deletion_blocked_by_x402_pending" },
                extra: {
                  userId,
                  taskX402PaymentId: unresolvedX402Payment.id,
                  resolveEndpoint: `POST /v1/admin/task-x402-payments/${unresolvedX402Payment.id}/resolve`,
                },
              },
            );
            throw new APIError("BAD_REQUEST", {
              code: "TASK_X402_PAYMENT_PENDING",
              message:
                "A task payment is still pending; contact support to have it resolved, then delete your account again.",
            });
          }
          // A status this code does not recognize: some later deploy added an
          // enum member and this branch has not been taught whether it is
          // sweepable. The resolve lever may not apply, so the page carries the
          // status instead of an endpoint.
          Sentry.captureMessage(
            "Account deletion blocked by an x402 task payment in an unhandled status",
            {
              level: "error",
              tags: { error_type: "user_deletion_blocked_by_x402_unhandled" },
              extra: {
                userId,
                taskX402PaymentId: unresolvedX402Payment.id,
                status: unresolvedX402Payment.status,
              },
            },
          );
          throw new APIError("BAD_REQUEST", {
            code: "TASK_X402_PAYMENT_UNRESOLVED",
            message:
              "A task payment is in a state that blocks account deletion. Contact support, then delete your account again.",
          });
        }

        // A signed header is a bearer authorization outside Soko's control once
        // delivered. Deleting its row while it can still settle erases the nonce,
        // attempt and transaction correlation needed for support/reconciliation.
        // REFUNDED rows are the canonical example: goodwill compensation does
        // not revoke the on-chain authorization, so the evidence still matters
        // until expiry.
        // A non-null validBefore in the past is provably dead; a null expiry is
        // legacy/unknown and remains blocked until the absolute header purge clears
        // xPaymentHeader.
        //
        // Deliberately NOT status-scoped, same principle as the header purge:
        // a credential-retention control must not depend on writer discipline.
        // Today only the VERIFIED write stores a header and FAILED provably
        // precedes issuance, but a status filter here would let a header-bearing
        // row in any other sweepable status slip past this guard and be
        // hard-deleted with its authorization live — the exact evidence loss
        // this block exists to prevent. The predicate costs nothing: rows
        // without a live header never match.
        const liveAuthorizationX402Payment = await tx.taskX402Payment.findFirst(
          {
            where: {
              xPaymentHeader: { not: null },
              AND: [
                {
                  OR: [
                    { validBefore: null },
                    { validBefore: { gt: new Date() } },
                  ],
                },
                {
                  OR: [
                    { transaction: { userId } },
                    { refundTransaction: { userId } },
                    { task: { ownerId: userId } },
                  ],
                },
              ],
            },
            select: { id: true, validBefore: true },
          },
        );
        if (liveAuthorizationX402Payment) {
          throw new APIError("BAD_REQUEST", {
            code: "TASK_X402_PAYMENT_AUTHORIZATION_LIVE",
            message:
              "A signed task payment authorization is still live. Retry account deletion after it expires, or contact support.",
          });
        }

        // The sweep below deletes on `task.ownerId` regardless of who was
        // charged. Task.ownerId is documented as always the billing owner, so a
        // row swept through the task-owner (or refund) branch whose charge belongs
        // to someone else should be unreachable — but nothing enforces that. If it
        // ever happens, continuing would let one user's account deletion destroy a
        // different live user's payment record: the charge Transaction survives,
        // while the chain leg, nonce, agent and network are lost. Narrowing the
        // sweep is not the fix (the task-owner branch is load-bearing for the
        // RESTRICT on taskId), so block until an operator repairs the ownership.
        const foreignChargePayment = await tx.taskX402Payment.findFirst({
          where: {
            // Exactly the sweep's status set: the detector exists to inspect the
            // rows the deleteMany below is about to remove, nothing else.
            status: { in: SWEEPABLE_X402_STATUSES },
            transaction: { userId: { not: userId } },
            // Only the non-charge branches can reach a foreign charge; the
            // `transaction: { userId }` branch is this user's own by definition.
            OR: [
              { refundTransaction: { userId } },
              { task: { ownerId: userId } },
            ],
          },
          select: {
            id: true,
            taskId: true,
            transaction: { select: { userId: true } },
          },
        });
        // Same narrowing as deletion-evaluate: `userId: { not: userId }`
        // excludes SQL NULL, so a matched charge always has a string actor.
        const foreignCharge =
          foreignChargePayment?.transaction.userId != null
            ? {
                id: foreignChargePayment.id,
                taskId: foreignChargePayment.taskId,
                chargedUserId: foreignChargePayment.transaction.userId,
              }
            : null;
        if (foreignCharge) {
          Sentry.captureMessage(
            "Account deletion would remove a task x402 payment charged to another user",
            {
              level: "error",
              tags: { error_type: "user_deletion_x402_payment_foreign_charge" },
              extra: {
                userId,
                taskX402PaymentId: foreignCharge.id,
                taskId: foreignCharge.taskId,
                chargedUserId: foreignCharge.chargedUserId,
                // The admin refund/resolve levers do NOT clear this condition —
                // they only move status, and every terminal status stays inside
                // the detector's predicate. Spell that out for whoever this
                // pages, or the on-call's first two attempts will both fail.
                repair:
                  "No admin endpoint clears this. Repair the ownership mismatch manually (align Task.ownerId with the charge Transaction's userId, or reassign the charge), then have the user retry deletion.",
              },
            },
          );
          throw new APIError("BAD_REQUEST", {
            code: "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH",
            message:
              "A task payment has inconsistent billing ownership; contact support to repair it, then delete your account again.",
          });
        }

        // Terminal x402 payments hold RESTRICT relations on the task, the
        // charge transaction, and any refund transaction; every branch must be
        // swept or the owned-task delete / user cascade fails. Operator
        // attribution survives in the FK-free task_x402_payment_action rows.
        //
        // Enumerating the sweepable statuses (rather than negating PENDING) is
        // deliberate: the unresolved guard above uses the same list inverted,
        // so a future enum member matches NEITHER — it blocks the deletion with
        // a page instead of being silently destroyed while it may still
        // represent money in flight. Fail-closed beats fail-destructive here;
        // the cost is one paged deletion when the enum grows before this code
        // learns the new member, never a raw RESTRICT-FK 500.
        await tx.taskX402Payment.deleteMany({
          where: {
            status: { in: SWEEPABLE_X402_STATUSES },
            OR: [
              { transaction: { userId } },
              { refundTransaction: { userId } },
              { task: { ownerId: userId } },
            ],
          },
        });

        const coworkerIds = (
          await tx.coworkerAssignment.findMany({
            where: { userId },
            select: { coworkerId: true },
          })
        ).map((assignment) => assignment.coworkerId);

        const createdTasks = await tx.task.findMany({
          where: {
            OR: [
              { creatorUserId: userId },
              ...(coworkerIds.length > 0
                ? [{ creatorCoworkerId: { in: coworkerIds } }]
                : []),
            ],
          },
          select: { id: true, ownerId: true },
        });

        for (const task of createdTasks) {
          if (task.ownerId === userId) continue;

          await tx.task.update({
            where: { id: task.id },
            data: {
              creatorUserId: task.ownerId,
              creatorCoworkerId: null,
              creatorSokoBotId: null,
            },
          });
        }

        const ownedFiles = await tx.taskFile.findMany({
          where: { task: { ownerId: userId } },
          select: { fileUrl: true, taskId: true },
        });

        await tx.task.deleteMany({
          where: { ownerId: userId },
        });

        const createdRooms = await tx.chatRoom.findMany({
          where: { createdByUserId: userId },
          select: {
            id: true,
            userMembers: {
              where: { userId: { not: userId } },
              select: { userId: true },
              take: 1,
              orderBy: { createdAt: "asc" },
            },
          },
        });

        for (const room of createdRooms) {
          const nextCreatorId = room.userMembers[0]?.userId;
          if (nextCreatorId) {
            await tx.chatRoom.update({
              where: { id: room.id },
              data: { createdByUserId: nextCreatorId },
            });
            continue;
          }

          await tx.chatRoom.delete({
            where: { id: room.id },
          });
        }

        // Better Auth's subsequent adapter delete is intentionally a not-found
        // no-op. Keeping this delete inside the lock/sweep transaction closes
        // the otherwise-unprotected gap after beforeDelete returns.
        await tx.user.deleteMany({ where: { id: userId } });

        return ownedFiles;
      },
      // Prisma's default interactive-transaction timeout is 5 s, and this
      // callback stopped being a handful of indexed lookups when the x402
      // locks, guards and sweeps moved in: lock waits behind an in-flight
      // charge and the per-task creator-repoint loop both count against the
      // same budget. On expiry Prisma throws P2028, which the conflict
      // mapping below does not (and should not) match, so a heavy account
      // would 500 deterministically on every retry. 30 s is headroom, not a
      // target — the transaction stays atomic either way.
      { maxWait: 5_000, timeout: 30_000 },
    );
  } catch (error) {
    if (isPrismaTransactionConflict(error)) {
      // Deliberately NOT an x402-specific code: this catch wraps the whole
      // transaction, and a write conflict or deadlock can just as well come
      // from the claim sweep, the creator-repoint loop, the owned-task
      // delete, or the user-row lock contending with an unrelated FK insert.
      // Naming a task payment here would send support chasing a payment that
      // may not exist.
      throw new APIError("BAD_REQUEST", {
        code: "ACCOUNT_DELETION_CONCURRENT_CHANGE",
        message:
          "Your account changed while deletion was being prepared. Retry account deletion.",
      });
    }
    throw error;
  }

  await Promise.all(
    ownedTaskFiles
      .filter(
        (file): file is { fileUrl: string; taskId: string } =>
          file.fileUrl !== null,
      )
      .map((file) => deleteTaskFileIfOwned(file.fileUrl, file.taskId)),
  );
}
