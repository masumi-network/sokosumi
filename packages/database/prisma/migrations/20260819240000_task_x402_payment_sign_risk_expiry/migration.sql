-- Persist a conservative lifetime for any authorization produced by a sign
-- attempt whose result was lost or discarded. Existing PENDING attempts use
-- the protocol-wide maximum: 20s request timeout + 3600s authorization window
-- + 60s clock-skew allowance.
ALTER TABLE "task_x402_payment"
ADD COLUMN "signRiskExpiresAt" TIMESTAMP(3);

UPDATE "task_x402_payment"
SET
  "processingAt" = COALESCE("processingAt", "updatedAt", "createdAt"),
  "signRiskExpiresAt" =
    COALESCE("processingAt", "updatedAt", "createdAt")
    + INTERVAL '3680 seconds'
WHERE "status" = 'PENDING';
