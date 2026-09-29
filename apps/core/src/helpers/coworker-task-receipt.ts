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
  // The pilot has one payment per task, so the newest claim is the one to
  // prove. Known limitation: if a task is later re-charged (a second claim),
  // this reports the newest claim only. An older settled claim on the same task
  // would then read as settled:false. Revisit with a status-aware selection if
  // re-charging Coworker tasks becomes a real flow.
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
    // MPS treats the seller as paid on "Withdrawn", or on "DisputedWithdrawn"
    // when the seller actually received funds (WithdrawnForSeller non-empty).
    // A refund ("RefundWithdrawn") is never a seller receipt.
    settled:
      onChainState === "Withdrawn" ||
      (onChainState === "DisputedWithdrawn" && withdrawnForSeller.length > 0),
    txHash: purchase.CurrentTransaction?.txHash ?? null,
    withdrawnForSeller,
  };
}
