import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";

/**
 * Creates a refund transaction and source credit bucket for a job when the job
 * paid for a failed or refunded on-chain outcome. Core job sync is the only caller.
 */
export async function refundJob(
  jobId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      refundedTransaction: true,
      transaction: true,
    },
  });

  if (job?.refundedTransaction) {
    return;
  }

  const transaction = job?.transaction;

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const amount = transaction.amount * BigInt(-1);
  await tx.job.update({
    where: { id: jobId },
    data: {
      refundedTransaction: {
        create: {
          amount,
          user: {
            connect: {
              id: transaction.userId,
            },
          },
          ...(transaction.organizationId && {
            organization: {
              connect: {
                id: transaction.organizationId,
              },
            },
          }),
          sourceCreditBucket: {
            create: {
              amount,
              referenceId: jobId,
              referenceType: CreditBucketReferenceType.REFUND,
              user: {
                connect: {
                  id: transaction.userId,
                },
              },
              expiresAt: null,
              ...(transaction.organizationId && {
                organization: {
                  connect: {
                    id: transaction.organizationId,
                  },
                },
              }),
            },
          },
        } satisfies Prisma.TransactionCreateInput,
      },
    },
  });
}
