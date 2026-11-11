import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";

export interface CompensatingRefundInput {
  /** Positive cents. Callers already negated the debit. */
  amount: bigint;
  actorUserId: string;
  /** Null personal pot. Non-null org pot writes bucket.userId null. */
  organizationId: string | null;
  referenceId: string;
  /** The spend's consumptions, read with `COMPENSATED_SPEND_CONSUMPTIONS_SELECT`. */
  consumptions: readonly { bucket: { projectId: string | null } }[];
}

/** Selects, on the spend transaction, what the refund needs to keep its Project. */
export const COMPENSATED_SPEND_CONSUMPTIONS_SELECT = {
  creditConsumptions: { select: { bucket: { select: { projectId: true } } } },
} satisfies Prisma.TransactionInclude;

/**
 * Nested transaction create shared by job, claim, and x402 refunds.
 *
 * Always unchecked scalars so org `userId: null` and personal `userId` share
 * one shape. Org refunds leave the ledger actor null; personal refunds stamp
 * the spend actor. The debit may have consumed expiring buckets, so the
 * refund bucket does not expire.
 *
 * A charge carries one Project, so it drew that Project's credits and then the
 * pool. One refund bucket per transaction, so a refund of a charge that spent
 * any Project credits goes back to that Project whole (ADR 0067).
 */
export function buildCompensatingRefundTransactionCreate(
  input: CompensatingRefundInput,
): Prisma.TransactionUncheckedCreateInput {
  const isOrg = input.organizationId != null;

  return {
    amount: input.amount,
    organizationId: input.organizationId,
    userId: isOrg ? null : input.actorUserId,
    sourceCreditBucket: {
      create: {
        amount: input.amount,
        referenceId: input.referenceId,
        referenceType: CreditBucketReferenceType.REFUND,
        expiresAt: null,
        userId: isOrg ? null : input.actorUserId,
        organizationId: input.organizationId,
        projectId:
          input.consumptions.find(({ bucket }) => bucket.projectId !== null)
            ?.bucket.projectId ?? null,
      },
    },
  };
}
