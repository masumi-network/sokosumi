-- Temporarily move enum column to text to allow value rewrite
ALTER TABLE "credit_bucket"
ALTER COLUMN "referenceType"
TYPE text
USING ("referenceType"::text);

-- Migrate existing invoice-backed buckets to top-up before enum swap
UPDATE "credit_bucket"
SET "referenceType" = 'STRIPE_TOPUP'
WHERE "referenceType" = 'STRIPE_INVOICE';

-- Create a replacement enum without STRIPE_INVOICE
CREATE TYPE "CreditBucketReferenceType_new" AS ENUM (
  'STRIPE_TOPUP',
  'STRIPE_SUBSCRIPTION_PERIOD',
  'JOB_REFUND'
);

-- Replace enum type to remove STRIPE_INVOICE permanently
ALTER TABLE "credit_bucket"
ALTER COLUMN "referenceType"
TYPE "CreditBucketReferenceType_new"
USING (
  "referenceType"
)::"CreditBucketReferenceType_new";

DROP TYPE "CreditBucketReferenceType";
ALTER TYPE "CreditBucketReferenceType_new" RENAME TO "CreditBucketReferenceType";
