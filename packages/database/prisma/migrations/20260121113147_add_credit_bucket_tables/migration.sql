-- CreateEnum
CREATE TYPE "CreditBucketReferenceType" AS ENUM ('STRIPE_INVOICE', 'JOB_REFUND');

-- CreateTable
CREATE TABLE "credit_bucket" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "referenceId" TEXT,
    "referenceType" "CreditBucketReferenceType",
    "sourceTransactionId" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,

    CONSTRAINT "credit_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_consumption" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" BIGINT NOT NULL,
    "bucketId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,

    CONSTRAINT "credit_consumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_bucket_sourceTransactionId_key" ON "credit_bucket"("sourceTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_bucket_referenceId_referenceType_key" ON "credit_bucket"("referenceId", "referenceType");

-- CreateIndex
CREATE INDEX "credit_bucket_userId_organizationId_expiresAt_idx" ON "credit_bucket"("userId", "organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "credit_bucket_expiresAt_idx" ON "credit_bucket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_consumption_bucketId_transactionId_key" ON "credit_consumption"("bucketId", "transactionId");

-- CreateIndex
CREATE INDEX "credit_consumption_bucketId_idx" ON "credit_consumption"("bucketId");

-- CreateIndex
CREATE INDEX "credit_consumption_transactionId_idx" ON "credit_consumption"("transactionId");

-- AddForeignKey
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_bucket" ADD CONSTRAINT "credit_bucket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_consumption" ADD CONSTRAINT "credit_consumption_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "credit_bucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_consumption" ADD CONSTRAINT "credit_consumption_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Remove old referenceId and referenceType columns from Transaction
-- Note: These columns will be dropped after data migration is complete
-- We keep them for now to preserve data during migration
-- ALTER TABLE "Transaction" DROP COLUMN "referenceId";
-- ALTER TABLE "Transaction" DROP COLUMN "referenceType";

-- DropEnum (will be done after data migration)
-- DROP TYPE "TransactionReferenceType";
