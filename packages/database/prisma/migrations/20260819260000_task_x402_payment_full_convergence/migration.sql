-- Converge every published shape of 20260819130000_task_x402_payment without
-- changing that migration again. Prisma never re-runs an applied migration,
-- so fixes added to the old file reached fresh databases only.

-- Keep enum evolution forward-only. These values exist in every known base
-- shape; restating them is harmless and gives a stale preview the current set.
-- Any future value must be added in its own migration before a later migration
-- stores or defaults to that value.
ALTER TYPE "TaskX402PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "TaskX402PaymentStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "TaskX402PaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "TaskX402PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- Old action-ledger shapes predate the denormalized financial snapshot. Add
-- required columns nullable first so existing rows can be backfilled safely.
ALTER TABLE "task_x402_payment_action"
  ADD COLUMN IF NOT EXISTS "cents" BIGINT,
  ADD COLUMN IF NOT EXISTS "amount" TEXT,
  ADD COLUMN IF NOT EXISTS "asset" TEXT,
  ADD COLUMN IF NOT EXISTS "caip2Network" TEXT,
  ADD COLUMN IF NOT EXISTS "taskId" TEXT,
  ADD COLUMN IF NOT EXISTS "agentId" TEXT,
  ADD COLUMN IF NOT EXISTS "chargedUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "chargedOrganizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "chargeTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "refundTransactionId" TEXT;

-- BIGINT's minimum value has no positive BIGINT magnitude. Refuse that corrupt
-- historical debit explicitly instead of overflowing midway through backfill.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_x402_payment_action" AS action
    INNER JOIN "task_x402_payment" AS payment
      ON payment."id" = action."paymentId"
    INNER JOIN "Transaction" AS charge
      ON charge."id" = payment."transactionId"
    WHERE action."cents" IS NULL
      AND charge."amount" = '-9223372036854775808'::BIGINT
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill task_x402_payment_action.cents: charge amount has no BIGINT magnitude';
  END IF;
END $$;

-- Surviving payments contain every required fact. Snapshot them before later
-- account deletion can remove payment and transaction rows. Nullable ledger
-- additions remain nullable for genuinely unrecoverable legacy evidence.
UPDATE "task_x402_payment_action" AS action
SET
  "cents" = CASE
    WHEN charge."amount" < 0 THEN -charge."amount"
    ELSE charge."amount"
  END,
  "amount" = payment."amount",
  "asset" = payment."asset",
  "caip2Network" = payment."caip2Network",
  "taskId" = payment."taskId",
  "agentId" = payment."agentId",
  "chargedUserId" = charge."userId",
  "chargedOrganizationId" = charge."organizationId",
  "chargeTransactionId" = payment."transactionId",
  "refundTransactionId" = payment."refundTransactionId"
FROM "task_x402_payment" AS payment
INNER JOIN "Transaction" AS charge
  ON charge."id" = payment."transactionId"
WHERE action."paymentId" = payment."id"
  AND (
    action."cents" IS NULL
    OR action."amount" IS NULL
    OR action."asset" IS NULL
    OR action."caip2Network" IS NULL
    OR action."taskId" IS NULL
    OR action."agentId" IS NULL
    OR action."chargedUserId" IS NULL
    OR action."chargeTransactionId" IS NULL
    OR action."refundTransactionId" IS NULL
  );

-- Never truncate replay keys or append-only audit evidence to make a bound fit.
-- A violating legacy row needs an explicit operator decision, so fail with the
-- exact invariant instead of PostgreSQL's opaque ALTER COLUMN error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment"
    WHERE CHAR_LENGTH("idempotencyKey") > 200
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment.idempotencyKey: value exceeds 200 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment"
    WHERE CHAR_LENGTH("caip2Network") > 64
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment.caip2Network: value exceeds 64 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment"
    WHERE CHAR_LENGTH("asset") > 128
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment.asset: value exceeds 128 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment"
    WHERE "payerAddress" IS NOT NULL AND CHAR_LENGTH("payerAddress") > 42
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment.payerAddress: value exceeds 42 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment"
    WHERE "payloadNonce" IS NOT NULL AND CHAR_LENGTH("payloadNonce") > 66
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment.payloadNonce: value exceeds 66 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment_action"
    WHERE CHAR_LENGTH("reason") > 500
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment_action.reason: value exceeds 500 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment_action"
    WHERE "asset" IS NOT NULL AND CHAR_LENGTH("asset") > 128
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment_action.asset: value exceeds 128 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_x402_payment_action"
    WHERE "caip2Network" IS NOT NULL AND CHAR_LENGTH("caip2Network") > 64
  ) THEN
    RAISE EXCEPTION 'Cannot bound task_x402_payment_action.caip2Network: value exceeds 64 characters';
  END IF;
END $$;

-- The canonicalization trigger's UPDATE OF list names these columns, and
-- PostgreSQL refuses to rewrite the type of a column a trigger definition
-- depends on (0A000). Drop the trigger for the rewrite and restate it
-- verbatim afterwards: same transaction, and the ALTER holds ACCESS
-- EXCLUSIVE on the table anyway, so no write can land un-normalized in
-- between. The function is untouched — only the trigger object depends on
-- the columns.
DROP TRIGGER IF EXISTS "task_x402_payment_replay_key_canonical_trg"
ON "task_x402_payment";

ALTER TABLE "task_x402_payment"
  ALTER COLUMN "idempotencyKey" TYPE VARCHAR(200),
  ALTER COLUMN "caip2Network" TYPE VARCHAR(64),
  ALTER COLUMN "asset" TYPE VARCHAR(128),
  ALTER COLUMN "payerAddress" TYPE VARCHAR(42),
  ALTER COLUMN "payloadNonce" TYPE VARCHAR(66);

CREATE TRIGGER "task_x402_payment_replay_key_canonical_trg"
BEFORE INSERT OR UPDATE OF "caip2Network", "asset", "payerAddress", "payloadNonce"
ON "task_x402_payment"
FOR EACH ROW
EXECUTE FUNCTION "normalize_task_x402_payment_replay_key"();

ALTER TABLE "task_x402_payment_action"
  ALTER COLUMN "reason" TYPE VARCHAR(500),
  ALTER COLUMN "asset" TYPE VARCHAR(128),
  ALTER COLUMN "caip2Network" TYPE VARCHAR(64);

-- Every historical action row must now have been recovered from its surviving
-- payment. Do not invent sentinel money or identity values for orphaned audit
-- evidence; stop deploy with a precise remediation target instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_x402_payment_action"
    WHERE "cents" IS NULL
      OR "amount" IS NULL
      OR "asset" IS NULL
      OR "caip2Network" IS NULL
      OR "taskId" IS NULL
      OR "agentId" IS NULL
      OR "chargedUserId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot require task_x402_payment_action snapshot: one or more legacy rows cannot be reconstructed';
  END IF;
END $$;

ALTER TABLE "task_x402_payment_action"
  ALTER COLUMN "cents" SET NOT NULL,
  ALTER COLUMN "amount" SET NOT NULL,
  ALTER COLUMN "asset" SET NOT NULL,
  ALTER COLUMN "caip2Network" SET NOT NULL,
  ALTER COLUMN "taskId" SET NOT NULL,
  ALTER COLUMN "agentId" SET NOT NULL,
  ALTER COLUMN "chargedUserId" SET NOT NULL;

-- Older base shapes had no all-or-nothing guard. Restate it after the earlier
-- canonicalization migration has normalized existing replay keys.
DO $$ BEGIN
  ALTER TABLE "task_x402_payment"
    ADD CONSTRAINT "task_x402_payment_nonce_payer_together_chk"
    CHECK (("payerAddress" IS NULL) = ("payloadNonce" IS NULL));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- An old shape can also be missing the replay unique entirely. Preflight gives
-- a deterministic diagnostic and prevents CREATE UNIQUE INDEX from becoming a
-- late, opaque deploy failure. Canonicalization already folded every key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "task_x402_payment"
    WHERE "payloadNonce" IS NOT NULL
    GROUP BY "caip2Network", "asset", "payerAddress", "payloadNonce"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create task_x402_payment_nonce_replay_uidx: duplicate replay keys exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "task_x402_payment_nonce_replay_uidx"
  ON "task_x402_payment" ("caip2Network", "asset", "payerAddress", "payloadNonce")
  WHERE "payloadNonce" IS NOT NULL;
