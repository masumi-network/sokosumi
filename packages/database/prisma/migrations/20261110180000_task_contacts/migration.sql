-- Tasks can tag many contacts. Replaces the single "task"."contactId" link
-- from 20261110120000_task_contact and keeps the links it already holds.

-- CreateTable
CREATE TABLE "task_contact" (
    "taskId" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_contact_pkey" PRIMARY KEY ("taskId","contactId")
);

-- CreateIndex
CREATE INDEX "task_contact_contactId_idx" ON "task_contact"("contactId");

-- AddForeignKey
ALTER TABLE "task_contact" ADD CONSTRAINT "task_contact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_contact" ADD CONSTRAINT "task_contact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy existing single-contact links
INSERT INTO "task_contact" ("taskId", "contactId")
SELECT "id", "contactId" FROM "task" WHERE "contactId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "task" DROP CONSTRAINT "task_contactId_fkey";

-- DropIndex
DROP INDEX "task_contactId_idx";

-- AlterTable
ALTER TABLE "task" DROP COLUMN "contactId";
