-- AlterTable
ALTER TABLE "contact_people_search" ADD COLUMN "contactId" UUID;

-- CreateIndex
CREATE INDEX "contact_people_search_contactId_idx" ON "contact_people_search"("contactId");

-- AddForeignKey
ALTER TABLE "contact_people_search" ADD CONSTRAINT "contact_people_search_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
