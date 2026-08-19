-- Old Core binaries omit the final correlation snapshot columns. Install a
-- compatibility trigger before the last backfill so writes during a rolling
-- deploy cannot become permanently incomplete after source-payment deletion.
BEGIN;

LOCK TABLE "task_x402_payment" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "task_x402_payment_action" IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION "complete_task_x402_payment_action_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  completed_organization_id TEXT;
  completed_charge_id TEXT;
  completed_refund_id TEXT;
BEGIN
  IF NEW."chargedOrganizationId" IS NULL
    OR NEW."chargeTransactionId" IS NULL
    OR NEW."refundTransactionId" IS NULL
  THEN
    SELECT
      COALESCE(NEW."chargedOrganizationId", charge."organizationId"),
      COALESCE(NEW."chargeTransactionId", payment."transactionId"),
      COALESCE(NEW."refundTransactionId", payment."refundTransactionId")
    INTO
      completed_organization_id,
      completed_charge_id,
      completed_refund_id
    FROM "task_x402_payment" AS payment
    INNER JOIN "Transaction" AS charge
      ON charge."id" = payment."transactionId"
    WHERE payment."id" = NEW."paymentId";

    IF FOUND THEN
      NEW."chargedOrganizationId" := completed_organization_id;
      NEW."chargeTransactionId" := completed_charge_id;
      NEW."refundTransactionId" := completed_refund_id;
    ELSIF NEW."chargeTransactionId" IS NULL
      OR NEW."refundTransactionId" IS NULL
    THEN
      RAISE EXCEPTION
        'Cannot write incomplete task x402 action snapshot without its source payment';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "task_x402_payment_action_snapshot_write_trg"
ON "task_x402_payment_action";

CREATE TRIGGER "task_x402_payment_action_snapshot_write_trg"
BEFORE INSERT OR UPDATE OF
  "paymentId",
  "chargedOrganizationId",
  "chargeTransactionId",
  "refundTransactionId"
ON "task_x402_payment_action"
FOR EACH ROW
EXECUTE FUNCTION "complete_task_x402_payment_action_snapshot"();

UPDATE "task_x402_payment_action" AS action
SET
  "chargedOrganizationId" = charge."organizationId",
  "chargeTransactionId" = payment."transactionId",
  "refundTransactionId" = payment."refundTransactionId"
FROM "task_x402_payment" AS payment
INNER JOIN "Transaction" AS charge
  ON charge."id" = payment."transactionId"
WHERE action."paymentId" = payment."id"
  AND (
    action."chargedOrganizationId" IS NULL
    OR action."chargeTransactionId" IS NULL
    OR action."refundTransactionId" IS NULL
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_x402_payment_action" AS action
    INNER JOIN "task_x402_payment" AS payment
      ON payment."id" = action."paymentId"
    WHERE action."chargeTransactionId" IS NULL
      OR action."refundTransactionId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot complete recoverable task x402 action snapshot';
  END IF;
END
$$;

COMMIT;
