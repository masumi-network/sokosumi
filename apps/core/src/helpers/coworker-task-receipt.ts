import { paymentClient } from "@/clients/masumi-payment.client";
import prisma from "@/lib/db/prisma";

// Proves the intended seller receipt for a Coworker Task. Core tracks only the
// TaskPaymentClaim (PENDING | PURCHASED | REFUNDED), which stops at the buyer
// debit. The real seller receipt lives on-chain, so we resolve the claim's
// purchase through the same Masumi Payment Service client the Job sync uses
// (paymentClient().resolvePurchase) and read its settlement state. The receipt
// is proven only when onChainState is "Withdrawn".

export interface TaskSellerReceipt {
  blockchainIdentifier: string | null;
  claimStatus: string | null;
  onChainState: string | null;
  settled: boolean;
  txHash: string | null;
  withdrawnForSeller: Array<{ unit: string | null; amount: string | null }>;
}

const NO_CLAIM: TaskSellerReceipt = {
  blockchainIdentifier: null,
  claimStatus: null,
  onChainState: null,
  settled: false,
  txHash: null,
  withdrawnForSeller: [],
};

export async function resolveTaskSellerReceipt(
  taskId: string,
  db: Pick<typeof prisma, "taskPaymentClaim"> = prisma,
): Promise<TaskSellerReceipt> {
  const claim = await db.taskPaymentClaim.findFirst({
    where: { taskEvent: { taskId } },
    orderBy: { createdAt: "desc" },
    select: { blockchainIdentifier: true, status: true },
  });
  if (!claim) return NO_CLAIM;

  const base: TaskSellerReceipt = {
    ...NO_CLAIM,
    blockchainIdentifier: claim.blockchainIdentifier,
    claimStatus: claim.status,
  };

  const resolved = await paymentClient().getPurchaseByBlockchainIdentifier(
    claim.blockchainIdentifier,
  );
  if (resolved.isErr()) return base;

  const purchase = resolved.value;
  const onChainState = purchase.onChainState ?? null;
  const withdrawnForSeller = (purchase.WithdrawnForSeller ?? []).map(
    (entry) => ({
      unit: entry.unit ?? null,
      amount: entry.amount == null ? null : String(entry.amount),
    }),
  );
  return {
    ...base,
    onChainState,
    settled: onChainState === "Withdrawn",
    txHash: purchase.CurrentTransaction?.txHash ?? null,
    withdrawnForSeller,
  };
}
