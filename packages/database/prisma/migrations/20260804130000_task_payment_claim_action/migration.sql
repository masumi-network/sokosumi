-- Append-only audit trail for operator decisions on task payment claims.
-- Refund/resolve can move money and retry clears `failureReason`, so operator
-- attribution cannot live in a mutable column on the claim itself.
CREATE TABLE "task_payment_claim_action" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "task_payment_claim_action_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_payment_claim_action_claimId_createdAt_idx" ON "task_payment_claim_action"("claimId", "createdAt");

ALTER TABLE "task_payment_claim_action" ADD CONSTRAINT "task_payment_claim_action_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "task_payment_claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_payment_claim_action" ADD CONSTRAINT "task_payment_claim_action_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
