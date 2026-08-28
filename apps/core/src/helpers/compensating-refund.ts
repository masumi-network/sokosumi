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
 * Nested TransactionCreateInput shared by job, claim, and x402 refunds.
 *
 * Scalar `userId` on the bucket is load-bearing. `user.connect` cannot
 * express org ownership. The debit may have consumed expiring buckets, so
 * the refund bucket does not expire.
 */
export function buildCompensatingRefundTransactionCreate(
  input: CompensatingRefundInput,
): Prisma.TransactionCreateInput {
  const bucketUserId = input.organizationId ? null : input.actorUserId;

  return {
    amount: input.amount,
    user: { connect: { id: input.actorUserId } },
    ...(input.organizationId
      ? { organization: { connect: { id: input.organizationId } } }
      : {}),
    sourceCreditBucket: {
      create: {
        amount: input.amount,
        referenceId: input.referenceId,
        referenceType: CreditBucketReferenceType.REFUND,
        expiresAt: null,
        userId: bucketUserId,
        organizationId: input.organizationId,
      },
    },
  } satisfies Prisma.TransactionCreateInput;
}
