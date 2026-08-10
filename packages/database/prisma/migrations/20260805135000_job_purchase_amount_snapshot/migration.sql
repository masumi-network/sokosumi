ALTER TABLE "Job"
ADD COLUMN "purchaseAmounts" JSONB,
ADD COLUMN "purchaseAmountMatchRequired" BOOLEAN NOT NULL DEFAULT false;
