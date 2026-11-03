-- AlterEnum
ALTER TYPE "NewsletterSubscriberSource" ADD VALUE 'CONTACTS';

-- AlterTable
ALTER TABLE "newsletter" ADD COLUMN "contactListId" UUID;
ALTER TABLE "newsletter_subscriber" ADD COLUMN "contactId" UUID;

-- CreateIndex
CREATE INDEX "newsletter_contactListId_idx" ON "newsletter"("contactListId");
CREATE INDEX "newsletter_subscriber_contactId_idx" ON "newsletter_subscriber"("contactId");

-- AddForeignKey
ALTER TABLE "newsletter" ADD CONSTRAINT "newsletter_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "contact_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "newsletter_subscriber" ADD CONSTRAINT "newsletter_subscriber_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
