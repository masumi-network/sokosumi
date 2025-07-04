-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "FiatTransaction" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_organizationId_idx" ON "CreditTransaction"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "FiatTransaction_userId_organizationId_idx" ON "FiatTransaction"("userId", "organizationId");

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiatTransaction" ADD CONSTRAINT "FiatTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
