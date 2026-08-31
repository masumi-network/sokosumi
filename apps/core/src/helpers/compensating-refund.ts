import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";

export interface CompensatingRefundInput {
  /** Positive cents. Callers already negated the debit. */
  amount: bigint;
  actorUserId: string;
  /** Null personal pot. Non-null org pot writes bucket.userId null. */
  organizationId: string | null;
  referenceId: string;
}

/**
 * Nested transaction create shared by job, claim, and x402 refunds.
 *
 * Always unchecked scalars so org `userId: null` and personal `userId` share
 * one shape. Org refunds leave the ledger actor null; personal refunds stamp
 * the spend actor. The debit may have consumed expiring buckets, so the
 * refund bucket does not expire.
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
      },
    },
  };
}
