-- Move enum column to text so values can be rewritten safely
ALTER TABLE "credit_bucket"
ALTER COLUMN "referenceType"
TYPE text
USING ("referenceType"::text);

-- Rename existing refund reference values
UPDATE "credit_bucket"
SET "referenceType" = 'REFUND'
WHERE "referenceType" = 'JOB_REFUND';

-- Recreate enum with consolidated free-credit type and renamed refund type
CREATE TYPE "CreditBucketReferenceType_new" AS ENUM (
  'STRIPE_TOPUP',
  'STRIPE_FREE',
  'STRIPE_SUBSCRIPTION_PERIOD',
  'REFUND'
);

ALTER TABLE "credit_bucket"
ALTER COLUMN "referenceType"
TYPE "CreditBucketReferenceType_new"
USING (
  "referenceType"
)::"CreditBucketReferenceType_new";

DROP TYPE "CreditBucketReferenceType";
ALTER TYPE "CreditBucketReferenceType_new" RENAME TO "CreditBucketReferenceType";
