-- AlterTable
ALTER TABLE "fundraising_prospect" ADD COLUMN     "introAskedAt" TIMESTAMP(3),
ADD COLUMN     "introDeclinedAt" TIMESTAMP(3),
ADD COLUMN     "introMadeAt" TIMESTAMP(3),
ADD COLUMN     "introViaContactId" UUID,
ADD COLUMN     "introViaUserId" TEXT;

-- AddForeignKey
ALTER TABLE "fundraising_prospect" ADD CONSTRAINT "fundraising_prospect_introViaContactId_fkey" FOREIGN KEY ("introViaContactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
