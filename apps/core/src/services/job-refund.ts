import type { Prisma } from "@sokosumi/database";

import { buildCompensatingRefundTransactionCreate } from "@/helpers/compensating-refund";

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
  const actorUserId = transaction.userId;
  if (actorUserId === null) {
    throw new Error("Spend transaction is missing userId");
  }
  await tx.job.update({
    where: { id: jobId },
    data: {
      refundedTransaction: {
        create: buildCompensatingRefundTransactionCreate({
          amount,
          actorUserId,
          organizationId: transaction.organizationId,
          referenceId: jobId,
        }),
      },
    },
  });
}
