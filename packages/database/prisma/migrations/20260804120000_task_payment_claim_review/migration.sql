ALTER TABLE "task_payment_claim"
ADD COLUMN "reviewRequiredAt" TIMESTAMP(3);

CREATE INDEX "task_payment_claim_network_reviewRequiredAt_nextAttemptAt_idx"
ON "task_payment_claim"("network", "reviewRequiredAt", "nextAttemptAt");
