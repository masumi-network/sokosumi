-- AlterTable
ALTER TABLE "task" ADD COLUMN "createdByCoworkerId" TEXT,
ADD COLUMN "awaitingAcceptance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "taskEvent" ADD COLUMN "heldByGrantId" TEXT;

-- CreateIndex
CREATE INDEX "taskEvent_heldByGrantId_idx" ON "taskEvent"("heldByGrantId");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_createdByCoworkerId_fkey" FOREIGN KEY ("createdByCoworkerId") REFERENCES "coworker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_heldByGrantId_fkey" FOREIGN KEY ("heldByGrantId") REFERENCES "coworker_grant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
