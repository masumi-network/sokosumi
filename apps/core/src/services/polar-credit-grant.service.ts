import type { CreditBucketReferenceType, Prisma } from "@sokosumi/database";

import { isCreditBucketReferenceUniqueConstraintError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

/**
 * Credits a CMO payment grants a Cuso's Project (ADR 0068): a plan's month or
 * a top-up pack. The plan grant, the top-up and the yearly grant job share it;
 * only the reference type and the expiry differ.
 */
export interface PolarCreditGrant {
  amount: bigint;
  expiresAt: Date;
  organizationId: string;
  projectId: string;
  /** `<orderId>:<monthIndex>`: the bucket's unique key with the type. */
  referenceId: string;
  referenceNote: string;
  referenceType: CreditBucketReferenceType;
  /**
   * The subscription the credits are for: a plan payment names its row (and
   * the yearly job the paid order a month belongs to); a top-up takes the
   * Project's subscription that has not ended.
   */
  subscription:
    | { subscriptionRowId: string; paidOrderId?: string }
    | { projectId: string };
}

export type PolarGrantOutcome =
  | "granted"
  | "already_granted"
  | "not_live"
  | "refunded";

/**
 * Grants the credits, with `alsoWrite` in the same transaction, and frees the
 * Project's tasks that waited for credits. The grant rides on the bucket's
 * unique key: a redelivered or raced payment ends there and grants nothing
 * more (`already_granted`). A subscription that has ended, a refunded paid
 * order or a Cuso no longer live gets nothing (`not_live`), nor does an order
 * Polar refunded before its payment arrived (`refunded`).
 */
export async function grantPolarCredits(
  grant: PolarCreditGrant,
  alsoWrite?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<PolarGrantOutcome> {
  const { amount, organizationId, projectId } = grant;
  try {
    return await prisma.$transaction(async (tx) => {
      if (await isOrderRefunded(tx, grant.referenceId)) return "refunded";
      if (!(await lockLiveSubscription(tx, grant))) return "not_live";
      await tx.transaction.create({
        data: {
          amount,
          organizationId,
          userId: null,
          sourceCreditBucket: {
            create: {
              amount,
              expiresAt: grant.expiresAt,
              organizationId,
              projectId,
              referenceId: grant.referenceId,
              referenceNote: grant.referenceNote,
              referenceType: grant.referenceType,
              userId: null,
            },
          },
        },
      });
      await alsoWrite?.(tx);
      await markOutOfCreditsTasksAsToppedUp({
        organizationId,
        projectId,
        tx,
        userId: null,
      });
      return "granted";
    });
  } catch (error) {
    if (!isCreditBucketReferenceUniqueConstraintError(error)) throw error;
    return "already_granted";
  }
}

/**
 * Writes the order's row and says whether Polar refunded the order. A refund
 * writes the same row first, so of the two whichever comes second sees the
 * other: this grant waits for the refund and sees it, or the Serializable
 * refund fails on the row this grant wrote and runs again, finding its bucket.
 */
async function isOrderRefunded(
  tx: Prisma.TransactionClient,
  referenceId: string,
): Promise<boolean> {
  const polarOrderId = referenceId.slice(0, referenceId.lastIndexOf(":"));
  const rows = await tx.$queryRaw<{ refundedAt: Date | null }[]>`
    INSERT INTO "polar_order" ("polarOrderId") VALUES (${polarOrderId})
    ON CONFLICT ("polarOrderId") DO UPDATE SET "polarOrderId" = EXCLUDED."polarOrderId"
    RETURNING "refundedAt"`;
  return Boolean(rows[0]?.refundedAt);
}

/**
 * Locks the subscription row the grant is for and says whether it may still
 * grant. Every ending revokes, and so writes this row, before it archives the
 * Cuso: a grant either waits for that write and sees it, or commits first and
 * the ending's write-off takes its credits. The Cuso's row is written too,
 * for an ending that found no subscription to revoke. The lock is a write,
 * not `FOR UPDATE`: a
 * Serializable refund whose snapshot predates the grant then fails on this
 * row and runs again, finding the new bucket.
 */
async function lockLiveSubscription(
  tx: Prisma.TransactionClient,
  grant: PolarCreditGrant,
): Promise<boolean> {
  const { subscription } = grant;
  const rows =
    "subscriptionRowId" in subscription
      ? await tx.$queryRaw<LockedSubscription[]>`
          UPDATE "polar_subscription" SET "updatedAt" = "updatedAt"
          WHERE "id" = ${subscription.subscriptionRowId}::uuid
          RETURNING "endedAt", "lastPaidOrderId", "lastPaidOrderRefundedAt"`
      : await tx.$queryRaw<LockedSubscription[]>`
          UPDATE "polar_subscription" SET "updatedAt" = "updatedAt"
          WHERE "projectId" = ${subscription.projectId}::uuid AND "endedAt" IS NULL
          RETURNING "endedAt", "lastPaidOrderId", "lastPaidOrderRefundedAt"`;
  const row = rows[0];
  if (!row || row.endedAt !== null) return false;
  if (
    "paidOrderId" in subscription &&
    (row.lastPaidOrderId !== subscription.paidOrderId ||
      row.lastPaidOrderRefundedAt !== null)
  ) {
    return false;
  }
  // Written, not read: an archive that holds the Cuso's row makes this wait
  // and then match nothing; one whose snapshot predates the grant fails on
  // this write and runs again, finding the bucket (`writeOffUnlessLiveCuso`).
  const { count } = await tx.sokoBot.updateMany({
    where: { ...LIVE_CUSO_WHERE, projectId: grant.projectId },
    data: { updatedAt: new Date() },
  });
  return count > 0;
}

interface LockedSubscription {
  endedAt: Date | null;
  lastPaidOrderId: string | null;
  lastPaidOrderRefundedAt: Date | null;
}
