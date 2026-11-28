import type { Prisma } from "@sokosumi/database";
import {
  COMPENSATED_SPEND_CONSUMPTIONS_SELECT,
  refund,
} from "@/lib/credits/refund";
import { createNetworkScope } from "@/lib/db/network-scope";

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
      transaction: { include: COMPENSATED_SPEND_CONSUMPTIONS_SELECT },
    },
  });

  if (job?.refundedTransaction) {
    return;
  }

  const transaction = job?.transaction;

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const refundId = await refund({
    // shortcut: the legacy transaction writes this deployment's own ledger;
    // ticket 25 passes the Job's Network.
    scope: createNetworkScope("mainnet"),
    tx,
    charge: transaction,
    referenceId: jobId,
  });
  await tx.job.update({
    where: { id: jobId },
    data: { refundedTransaction: { connect: { id: refundId } } },
  });
}
