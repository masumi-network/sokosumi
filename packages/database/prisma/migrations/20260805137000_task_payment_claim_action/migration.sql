-- Append-only audit trail for operator decisions on task payment claims.
-- Refund/resolve can move money and retry clears `failureReason`, so operator
-- attribution cannot live in a mutable column on the claim itself.
--
-- Deliberately FK-free. Both referents are erased by ordinary lifecycle work:
-- account deletion hard-deletes terminal claims (see prepareTasksForUserDeletion)
-- and can remove the operator's own User row. A CASCADE would let that erase the
-- financial audit trail, and a RESTRICT would make account deletion fail — so the
-- ids are stored as plain values that outlive both, which is the normal shape for
-- an audit log.
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

CREATE INDEX "task_payment_claim_action_operatorId_createdAt_idx" ON "task_payment_claim_action"("operatorId", "createdAt");
