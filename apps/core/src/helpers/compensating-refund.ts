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
 * Scalar `userId` on the bucket is load-bearing. Org refunds write
 * transaction `userId` null. Personal refunds still connect the actor.
 * The debit may have consumed expiring buckets, so the refund bucket does not
 * expire.
 */
export function buildCompensatingRefundTransactionCreate(
  input: CompensatingRefundInput,
): Prisma.TransactionCreateInput | Prisma.TransactionUncheckedCreateInput {
  const bucketUserId = input.organizationId ? null : input.actorUserId;
  const sourceCreditBucket = {
    create: {
      amount: input.amount,
      referenceId: input.referenceId,
      referenceType: CreditBucketReferenceType.REFUND,
      expiresAt: null,
      userId: bucketUserId,
      organizationId: input.organizationId,
    },
  };

  if (input.organizationId) {
    return {
      amount: input.amount,
      organizationId: input.organizationId,
      userId: null,
      sourceCreditBucket,
    };
  }

  return {
    amount: input.amount,
    user: { connect: { id: input.actorUserId } },
    sourceCreditBucket,
  };
}
