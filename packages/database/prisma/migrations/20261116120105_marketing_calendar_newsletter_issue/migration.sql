-- AlterTable
ALTER TABLE "marketing_strategy_file" ADD COLUMN     "newsletterIssueId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "marketing_strategy_file_newsletterIssueId_key" ON "marketing_strategy_file"("newsletterIssueId");

-- AddForeignKey
ALTER TABLE "marketing_strategy_file" ADD CONSTRAINT "marketing_strategy_file_newsletterIssueId_fkey" FOREIGN KEY ("newsletterIssueId") REFERENCES "newsletter_issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
