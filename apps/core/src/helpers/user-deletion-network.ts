import {
  type Prisma,
  TaskPaymentClaimStatus,
  TaskVisibility,
} from "@sokosumi/database";
import {
  netTable,
  netType,
  sharedTable,
  sharedType,
} from "@sokosumi/database/sql-tables";

import { SWEEPABLE_X402_STATUSES } from "@/helpers/task-deletion-payments";
import type { Network } from "@/lib/network";

/**
 * The account deletion's reads and writes on one Network's payment and Job
 * rows. Raw SQL, because the deletion's transaction is on the shared client,
 * whose models name the shared schema. Each statement keeps the filter of the
 * model call it replaced.
 */
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

const TERMINAL_CLAIM_STATUSES = [
  TaskPaymentClaimStatus.PURCHASED,
  TaskPaymentClaimStatus.REFUNDED,
];

// Three UNIONed arms rather than one join with an OR across charge,
// refund and task: a disjunction whose branches live in three different
// joined relations cannot be served by any index, so the single-query
// form had to build and filter the full payments join on every account
// deletion — while holding the user and task locks above. Each arm here
// seeks (Transaction has a userId-leading index, task has ownerId, and
// the payment side is reached over its transactionId/refundTransactionId
// uniques and the taskId unique prefix). Only the outer SELECT takes
// locks, exactly like FOR UPDATE OF payment did on the join.
export async function lockX402PaymentsOfUser(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT payment."id"
    FROM ${netTable(network, "task_x402_payment")} AS payment
    WHERE payment."id" IN (
      SELECT charge_payment."id"
      FROM ${netTable(network, "task_x402_payment")} AS charge_payment
      INNER JOIN ${netTable(network, "Transaction")} AS charge
        ON charge."id" = charge_payment."transactionId"
      WHERE charge."userId" = ${userId}
      UNION
      SELECT refund_payment."id"
      FROM ${netTable(network, "task_x402_payment")} AS refund_payment
      INNER JOIN ${netTable(network, "Transaction")} AS refund
        ON refund."id" = refund_payment."refundTransactionId"
      WHERE refund."userId" = ${userId}
      UNION
      SELECT task_payment."id"
      FROM ${netTable(network, "task_x402_payment")} AS task_payment
      INNER JOIN ${sharedTable("task")} AS payment_task
        ON payment_task."id" = task_payment."taskId"
      WHERE payment_task."ownerId" = ${userId}
    )
    FOR UPDATE OF payment
  `;
}

export async function findReviewRequiredClaim(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<{ id: string; reviewRequiredAt: Date } | undefined> {
  const [claim] = await tx.$queryRaw<{ id: string; reviewRequiredAt: Date }[]>`
    SELECT claim."id", claim."reviewRequiredAt"
    FROM ${netTable(network, "task_payment_claim")} AS claim
    INNER JOIN ${netTable(network, "Transaction")} AS charge
      ON charge."id" = claim."transactionId"
    WHERE claim."status" = ${TaskPaymentClaimStatus.PENDING}::${netType(network, "TaskPaymentClaimStatus")}
      AND claim."reviewRequiredAt" IS NOT NULL
      AND charge."userId" = ${userId}
    LIMIT 1
  `;
  return claim;
}

export async function findPendingClaim(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<{ id: string } | undefined> {
  const [claim] = await tx.$queryRaw<{ id: string }[]>`
    SELECT claim."id"
    FROM ${netTable(network, "task_payment_claim")} AS claim
    INNER JOIN ${netTable(network, "Transaction")} AS charge
      ON charge."id" = claim."transactionId"
    WHERE claim."status" = ${TaskPaymentClaimStatus.PENDING}::${netType(network, "TaskPaymentClaimStatus")}
      AND charge."userId" = ${userId}
    LIMIT 1
  `;
  return claim;
}

export async function deleteTerminalClaims(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM ${netTable(network, "task_payment_claim")} AS claim
    WHERE claim."status" = ANY(${TERMINAL_CLAIM_STATUSES}::${netType(network, "TaskPaymentClaimStatus")}[])
      AND (
        EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS charge
          WHERE charge."id" = claim."transactionId" AND charge."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS refund
          WHERE refund."id" = claim."refundTransactionId" AND refund."userId" = ${userId}
        )
      )
  `;
}

export async function findUnresolvedX402Payment(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<{ id: string; status: string } | undefined> {
  const [payment] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT payment."id", payment."status"::text AS status
    FROM ${netTable(network, "task_x402_payment")} AS payment
    WHERE payment."status" <> ALL(${SWEEPABLE_X402_STATUSES}::${netType(network, "TaskX402PaymentStatus")}[])
      AND (
        EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS charge
          WHERE charge."id" = payment."transactionId" AND charge."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS refund
          WHERE refund."id" = payment."refundTransactionId" AND refund."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${sharedTable("task")} AS payment_task
          WHERE payment_task."id" = payment."taskId" AND payment_task."ownerId" = ${userId}
        )
      )
    LIMIT 1
  `;
  return payment;
}

export async function findLiveAuthorizationX402Payment(
  tx: Tx,
  network: Network,
  userId: string,
  now: Date,
): Promise<{ id: string } | undefined> {
  const [payment] = await tx.$queryRaw<{ id: string }[]>`
    SELECT payment."id"
    FROM ${netTable(network, "task_x402_payment")} AS payment
    WHERE payment."xPaymentHeader" IS NOT NULL
      AND (payment."validBefore" IS NULL OR payment."validBefore" > ${now}::timestamp)
      AND (
        EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS charge
          WHERE charge."id" = payment."transactionId" AND charge."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS refund
          WHERE refund."id" = payment."refundTransactionId" AND refund."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${sharedTable("task")} AS payment_task
          WHERE payment_task."id" = payment."taskId" AND payment_task."ownerId" = ${userId}
        )
      )
    LIMIT 1
  `;
  return payment;
}

/**
 * A payment the sweep would remove whose charge belongs to someone else.
 * `charge."userId" <> userId` excludes SQL NULL, so a match always has a
 * charged user.
 */
export async function findForeignChargeX402Payment(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<{ id: string; taskId: string; chargedUserId: string } | undefined> {
  const [payment] = await tx.$queryRaw<
    { id: string; taskId: string; chargedUserId: string }[]
  >`
    SELECT payment."id", payment."taskId", charge."userId" AS "chargedUserId"
    FROM ${netTable(network, "task_x402_payment")} AS payment
    INNER JOIN ${netTable(network, "Transaction")} AS charge
      ON charge."id" = payment."transactionId"
    WHERE payment."status" = ANY(${SWEEPABLE_X402_STATUSES}::${netType(network, "TaskX402PaymentStatus")}[])
      AND charge."userId" <> ${userId}
      AND (
        EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS refund
          WHERE refund."id" = payment."refundTransactionId" AND refund."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${sharedTable("task")} AS payment_task
          WHERE payment_task."id" = payment."taskId" AND payment_task."ownerId" = ${userId}
        )
      )
    LIMIT 1
  `;
  return payment;
}

export async function deleteSweepableX402Payments(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM ${netTable(network, "task_x402_payment")} AS payment
    WHERE payment."status" = ANY(${SWEEPABLE_X402_STATUSES}::${netType(network, "TaskX402PaymentStatus")}[])
      AND (
        EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS charge
          WHERE charge."id" = payment."transactionId" AND charge."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${netTable(network, "Transaction")} AS refund
          WHERE refund."id" = payment."refundTransactionId" AND refund."userId" = ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${sharedTable("task")} AS payment_task
          WHERE payment_task."id" = payment."taskId" AND payment_task."ownerId" = ${userId}
        )
      )
  `;
}

/**
 * Deletes the Jobs that go with the account: those on the private Tasks this
 * user owns, and every Job in their personal workspace. Returns their ids.
 *
 * One statement, so the Jobs it deletes are the ones that match when it
 * locks them: a Job that another session moved out of the personal workspace
 * a moment ago stays. Its caller handles the shared rows that pointed at the
 * returned Jobs afterwards.
 */
export async function deleteJobsOfUser(
  tx: Tx,
  network: Network,
  userId: string,
): Promise<string[]> {
  const jobs = await tx.$queryRaw<{ id: string }[]>`
    DELETE FROM ${netTable(network, "Job")} AS job
    WHERE (
        job."ownerId" = ${userId}
        AND EXISTS (
          SELECT 1 FROM ${sharedTable("task")} AS job_task
          WHERE job_task."id" = job."taskId"
            AND job_task."ownerId" = ${userId}
            AND job_task."visibility" = ${TaskVisibility.PRIVATE}::${sharedType("TaskVisibility")}
        )
      )
      OR EXISTS (
        SELECT 1 FROM ${sharedTable("workspace")} AS job_workspace
        WHERE job_workspace."id" = job."workspaceId" AND job_workspace."userId" = ${userId}
      )
    RETURNING job."id"
  `;
  return jobs.map((job) => job.id);
}
