-- Existing deployments already applied the original task_x402_payment
-- migration. Normalize replay keys in a forward migration so every database,
-- not only fresh ones, receives the invariant.
--
-- The trigger must land BEFORE the CHECK. Core migrations run while the
-- previous deployment is still serving, and that writer stores the node's
-- mixed-case nonce verbatim. Normalize at the database boundary so old and new
-- writers remain compatible throughout the rollout.
CREATE OR REPLACE FUNCTION "normalize_task_x402_payment_replay_key"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."caip2Network" := LOWER(NEW."caip2Network");
  NEW."asset" := LOWER(NEW."asset");
  NEW."payerAddress" := LOWER(NEW."payerAddress");
  NEW."payloadNonce" := LOWER(NEW."payloadNonce");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "task_x402_payment_replay_key_canonical_trg"
ON "task_x402_payment";

CREATE TRIGGER "task_x402_payment_replay_key_canonical_trg"
BEFORE INSERT OR UPDATE OF "caip2Network", "asset", "payerAddress", "payloadNonce"
ON "task_x402_payment"
FOR EACH ROW
EXECUTE FUNCTION "normalize_task_x402_payment_replay_key"();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_x402_payment"
    WHERE "payloadNonce" IS NOT NULL
    GROUP BY
      LOWER("caip2Network"),
      LOWER("asset"),
      LOWER("payerAddress"),
      LOWER("payloadNonce")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot canonicalize task_x402_payment replay keys: case-folded duplicates exist';
  END IF;
END $$;

UPDATE "task_x402_payment"
SET
  "caip2Network" = LOWER("caip2Network"),
  "asset" = LOWER("asset"),
  "payerAddress" = LOWER("payerAddress"),
  "payloadNonce" = LOWER("payloadNonce")
WHERE
  "caip2Network" <> LOWER("caip2Network") OR
  "asset" <> LOWER("asset") OR
  ("payerAddress" IS NOT NULL AND "payerAddress" <> LOWER("payerAddress")) OR
  ("payloadNonce" IS NOT NULL AND "payloadNonce" <> LOWER("payloadNonce"));

ALTER TABLE "task_x402_payment"
  ADD CONSTRAINT "task_x402_payment_replay_key_canonical_chk"
  CHECK (
    "caip2Network" = LOWER("caip2Network") AND
    "asset" = LOWER("asset") AND
    ("payerAddress" IS NULL OR "payerAddress" = LOWER("payerAddress")) AND
    ("payloadNonce" IS NULL OR "payloadNonce" = LOWER("payloadNonce"))
  );

-- The original migration also gained this constraint after some preview
-- databases had already applied its name. Restate it here so the replay tuple
-- is all-or-nothing everywhere, not only on fresh databases.
DO $$ BEGIN
  ALTER TABLE "task_x402_payment"
    ADD CONSTRAINT "task_x402_payment_nonce_payer_together_chk"
    CHECK (("payerAddress" IS NULL) = ("payloadNonce" IS NULL));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
