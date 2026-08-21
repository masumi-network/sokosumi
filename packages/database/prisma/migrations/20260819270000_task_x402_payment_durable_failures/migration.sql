-- Failure counts drive the admin quality ranking. Keep one FK-free outcome per
-- refused payment so deleting the terminal payment cannot erase that history.
BEGIN;

-- Prisma does not wrap PostgreSQL migrations implicitly. Take write locks
-- before any preflight/index/trigger statement so an old binary cannot create
-- and account deletion erase a FAILED payment inside an uncovered interval.
-- At commit the trigger becomes visible before either table accepts writes.
LOCK TABLE "task_x402_payment" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "task_x402_payment_action" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_x402_payment" AS payment
    INNER JOIN "Transaction" AS charge
      ON charge."id" = payment."transactionId"
    WHERE payment."status" = 'FAILED'
      AND charge."amount" = '-9223372036854775808'::BIGINT
  ) THEN
    RAISE EXCEPTION
      'Cannot snapshot task x402 failure: charge amount has no BIGINT magnitude';
  END IF;

  IF EXISTS (
    SELECT "paymentId"
    FROM "task_x402_payment_action"
    WHERE "action" = 'failure'
    GROUP BY "paymentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one task x402 failure outcome: duplicate paymentId';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_action_failure_payment_uidx"
ON "task_x402_payment_action"("paymentId")
WHERE "action" = 'failure';

-- Old binaries do not write failure actions. Trigger closes that rolling
-- deploy window; new binaries use createMany(skipDuplicates), converging on
-- the same partial unique index when both writers run.
CREATE OR REPLACE FUNCTION "record_task_x402_payment_failure_outcome"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."status" = 'FAILED' AND NEW."refundTransactionId" IS NOT NULL THEN
    INSERT INTO "task_x402_payment_action" (
      "id",
      "createdAt",
      "paymentId",
      "action",
      "operatorId",
      "reason",
      "cents",
      "amount",
      "asset",
      "caip2Network",
      "taskId",
      "agentId",
      "chargedUserId",
      "chargedOrganizationId",
      "chargeTransactionId",
      "refundTransactionId"
    )
    SELECT
      gen_random_uuid()::TEXT,
      CURRENT_TIMESTAMP,
      NEW."id",
      'failure',
      'system:x402',
      CASE
        WHEN NEW."failureReason" IN (
          'node_refused_payload',
          'node_refused_operational'
        ) THEN NEW."failureReason"
        ELSE 'legacy_node_refusal'
      END,
      CASE
        WHEN charge."amount" < 0 THEN charge."amount" * -1
        ELSE charge."amount"
      END,
      NEW."amount",
      NEW."asset",
      NEW."caip2Network",
      NEW."taskId",
      NEW."agentId",
      charge."userId",
      charge."organizationId",
      NEW."transactionId",
      NEW."refundTransactionId"
    FROM "Transaction" AS charge
    WHERE charge."id" = NEW."transactionId"
    ON CONFLICT ("paymentId") WHERE "action" = 'failure' DO NOTHING;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "task_x402_payment_failure_outcome_trg"
ON "task_x402_payment";

CREATE TRIGGER "task_x402_payment_failure_outcome_trg"
AFTER INSERT OR UPDATE OF "status", "refundTransactionId"
ON "task_x402_payment"
FOR EACH ROW
EXECUTE FUNCTION "record_task_x402_payment_failure_outcome"();

-- Backfill only after trigger activation. Any old binary that finishes a
-- refusal while this scan runs is caught by the trigger; partial uniqueness
-- makes trigger and scan converge on one row.
INSERT INTO "task_x402_payment_action" (
  "id",
  "createdAt",
  "paymentId",
  "action",
  "operatorId",
  "reason",
  "cents",
  "amount",
  "asset",
  "caip2Network",
  "taskId",
  "agentId",
  "chargedUserId",
  "chargedOrganizationId",
  "chargeTransactionId",
  "refundTransactionId"
)
SELECT
  gen_random_uuid()::TEXT,
  payment."updatedAt",
  payment."id",
  'failure',
  'system:x402',
  CASE
    WHEN payment."failureReason" IN (
      'node_refused_payload',
      'node_refused_operational'
    ) THEN payment."failureReason"
    ELSE 'legacy_node_refusal'
  END,
  CASE
    WHEN charge."amount" < 0 THEN charge."amount" * -1
    ELSE charge."amount"
  END,
  payment."amount",
  payment."asset",
  payment."caip2Network",
  payment."taskId",
  payment."agentId",
  charge."userId",
  charge."organizationId",
  payment."transactionId",
  payment."refundTransactionId"
FROM "task_x402_payment" AS payment
INNER JOIN "Transaction" AS charge
  ON charge."id" = payment."transactionId"
WHERE payment."status" = 'FAILED'
ON CONFLICT ("paymentId") WHERE "action" = 'failure' DO NOTHING;

COMMIT;
