-- SOK-906: CreditBucket is a personal pot XOR an organization pot.
-- Cleanup then CHECK in one migration so deploy cannot add XOR on dirty rows.
-- Classify table must match packages/database/src/helpers/credit-bucket-owner-xor.ts.

-- leftover_member_period_rem_gt0: write off remaining against leftover userId.
-- Do not mint. Do not SET userId NULL (org period spend is userId IS NULL).
WITH leftover AS MATERIALIZED (
  SELECT
    cb.id AS bucket_id,
    cb."userId" AS user_id,
    cb."organizationId" AS organization_id,
    (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
  FROM credit_bucket cb
  LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
  WHERE cb."userId" IS NOT NULL
    AND cb."organizationId" IS NOT NULL
    AND cb."referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'::"CreditBucketReferenceType"
    AND cb."referenceId" LIKE 'member:%'
  GROUP BY cb.id, cb."userId", cb."organizationId", cb.amount
  HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
),
prepared AS MATERIALIZED (
  SELECT
    leftover.*,
    gen_random_uuid()::text AS transaction_id,
    gen_random_uuid()::text AS consumption_id
  FROM leftover
),
inserted_tx AS (
  INSERT INTO "Transaction" (id, "createdAt", "updatedAt", amount, "userId", "organizationId")
  SELECT
    transaction_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    -remaining,
    user_id,
    organization_id
  FROM prepared
  RETURNING id
)
INSERT INTO credit_consumption (id, "createdAt", amount, "bucketId", "transactionId")
SELECT
  prepared.consumption_id,
  CURRENT_TIMESTAMP,
  prepared.remaining,
  prepared.bucket_id,
  prepared.transaction_id
FROM prepared
INNER JOIN inserted_tx ON inserted_tx.id = prepared.transaction_id;

-- leftover_member_period_rem0 and drained rem_gt0 (including leftover remaining <= 0)
DELETE FROM credit_bucket
WHERE "userId" IS NOT NULL
  AND "organizationId" IS NOT NULL
  AND "referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'::"CreditBucketReferenceType"
  AND "referenceId" LIKE 'member:%';

-- dual_owned_non_period
UPDATE credit_bucket
SET "userId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "userId" IS NOT NULL
  AND "organizationId" IS NOT NULL
  AND "referenceType" IS DISTINCT FROM 'STRIPE_SUBSCRIPTION_PERIOD'::"CreditBucketReferenceType";

-- dual_owned_org_period (not member:)
UPDATE credit_bucket
SET "userId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "userId" IS NOT NULL
  AND "organizationId" IS NOT NULL
  AND "referenceType" = 'STRIPE_SUBSCRIPTION_PERIOD'::"CreditBucketReferenceType"
  AND ("referenceId" IS NULL OR "referenceId" NOT LIKE 'member:%');

-- both_null_rem_gt0
DO $$
DECLARE
  leftover_rows integer;
  leftover_cents bigint;
BEGIN
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(remaining), 0)
  INTO leftover_rows, leftover_cents
  FROM (
    SELECT (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint AS remaining
    FROM credit_bucket cb
    LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
    WHERE cb."userId" IS NULL
      AND cb."organizationId" IS NULL
    GROUP BY cb.id, cb.amount
    HAVING (cb.amount - COALESCE(SUM(cc.amount), 0)) > 0
  ) both_null_positive;

  IF leftover_rows > 0 THEN
    RAISE EXCEPTION
      'SOK-906: % credit_bucket row(s) have remaining > 0 with both userId and organizationId null (cents=%); refuse to invent an owner',
      leftover_rows,
      leftover_cents;
  END IF;
END $$;

-- both_null_rem0
DELETE FROM credit_bucket
WHERE "userId" IS NULL
  AND "organizationId" IS NULL;

DO $$
DECLARE
  illegal_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO illegal_count
  FROM credit_bucket
  WHERE NOT (
    ("userId" IS NOT NULL AND "organizationId" IS NULL)
    OR
    ("organizationId" IS NOT NULL AND "userId" IS NULL)
  );

  IF illegal_count > 0 THEN
    RAISE EXCEPTION
      'SOK-906: % credit_bucket row(s) still violate owner XOR',
      illegal_count;
  END IF;
END $$;

ALTER TABLE "credit_bucket"
  ADD CONSTRAINT "credit_bucket_owner_xor_check" CHECK (
    ("userId" IS NOT NULL AND "organizationId" IS NULL)
    OR
    ("organizationId" IS NOT NULL AND "userId" IS NULL)
  );

ALTER TABLE "credit_bucket" DROP CONSTRAINT "credit_bucket_userId_fkey";
ALTER TABLE "credit_bucket" DROP CONSTRAINT "credit_bucket_organizationId_fkey";

ALTER TABLE "credit_bucket"
  ADD CONSTRAINT "credit_bucket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_bucket"
  ADD CONSTRAINT "credit_bucket_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
