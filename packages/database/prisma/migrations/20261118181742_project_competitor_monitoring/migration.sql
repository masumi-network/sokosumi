-- AlterTable
ALTER TABLE "project" ADD COLUMN "competitorChecksSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "competitor_check" ADD COLUMN "transactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "competitor_check_transactionId_key" ON "competitor_check"("transactionId");

-- AddForeignKey
ALTER TABLE "competitor_check" ADD CONSTRAINT "competitor_check_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
