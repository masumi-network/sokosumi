import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import { badGateway, internalServerError } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { parsePurchasePayload } from "@/services/task-payment-claim.service";

// Proves the intended seller receipt for a Coworker Task. Core tracks only the
// TaskPaymentClaim (PENDING | PURCHASED | REFUNDED), which stops at the buyer
// debit. The real seller receipt lives on-chain, so we resolve the claim's
// purchase through the same Masumi Payment Service seam the claim sync uses
// (resolveMasumiTaskPaymentPurchase), which only accepts a purchase matching the
// claim's stored terms, and read its settlement state. See the `settled` rule
// below for what counts as a seller receipt.

const RECEIPT_REQUEST_TIMEOUT_MS = 20_000;

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
  options: { signal?: AbortSignal } = {},
): Promise<TaskSellerReceipt> {
  // The pilot has one payment per task, so the newest claim is the one to
  // prove. Known limitation: if a task is later re-charged (a second claim),
  // this reports the newest claim only. An older settled claim on the same task
  // would then read as settled:false. A claim whose TaskEvent was deleted
  // (taskEventId set null) is not found either. Revisit with a status-aware
  // selection if re-charging Coworker tasks becomes a real flow.
  const claim = await db.taskPaymentClaim.findFirst({
    // Same network scope as the claim sync: only this deployment's node can
    // resolve the claim.
    where: { network: getEnv().NETWORK, taskEvent: { taskId } },
    orderBy: { createdAt: "desc" },
    select: { blockchainIdentifier: true, purchasePayload: true, status: true },
  });
  if (!claim) return NO_CLAIM;

  const base: TaskSellerReceipt = {
    ...NO_CLAIM,
    blockchainIdentifier: claim.blockchainIdentifier,
    claimStatus: claim.status,
  };

  let payload: ReturnType<typeof parsePurchasePayload>;
  try {
    payload = parsePurchasePayload(claim.purchasePayload);
  } catch {
    // The claim sync already sends such claims to review. Answer with a plain
    // 500 so each read does not raise a fatal validation event.
    throw internalServerError("Stored task payment cannot be read");
  }

  const timeout = AbortSignal.timeout(RECEIPT_REQUEST_TIMEOUT_MS);
  const resolved = await paymentClient().resolveMasumiTaskPaymentPurchase(
    payload,
    {
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
    },
  );
  if (resolved.isErr()) {
    // No purchase on the node yet is a real "not settled" answer, unless the
    // sync already confirmed the purchase: then a 404 is a node or proxy
    // fault. A mismatch on a claim the sync already refunded for that
    // mismatch never changes, and a 5xx would invite retries. Any other node
    // failure or mismatch is not an answer: settled:false there would read as
    // a proven non-payment.
    if (
      (resolved.error.kind === "not_found" && claim.status !== "PURCHASED") ||
      (resolved.error.kind === "mismatch" && claim.status === "REFUNDED")
    ) {
      return base;
    }
    // The caller went away, so nobody reads this answer. Skip the 502 so a
    // dropped connection does not report as a payment node fault.
    if (options.signal?.aborted) return base;
    throw badGateway(
      resolved.error.kind === "mismatch"
        ? "Resolved purchase does not match the task payment"
        : "Could not resolve the task payment from the Masumi Payment Service",
    );
  }

  const purchase = resolved.value;
  const onChainState = purchase.onChainState ?? null;
  const withdrawnForSeller = (purchase.WithdrawnForSeller ?? []).map(
    (entry) => ({
      unit: entry.unit ?? null,
      amount: entry.amount == null ? null : String(entry.amount),
    }),
  );
  // MPS treats the seller as paid on "Withdrawn", or on "DisputedWithdrawn"
  // when the seller actually received funds (WithdrawnForSeller non-empty).
  // A refund ("RefundWithdrawn") is never a seller receipt.
  const settled =
    onChainState === "Withdrawn" ||
    (onChainState === "DisputedWithdrawn" && withdrawnForSeller.length > 0);
  return {
    ...base,
    onChainState,
    settled,
    // Only a settled purchase carries a settlement transaction. Otherwise the
    // current transaction is a lock or a refund, which proves nothing.
    txHash: settled ? (purchase.CurrentTransaction?.txHash ?? null) : null,
    withdrawnForSeller,
  };
}
