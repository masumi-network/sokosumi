-- AlterTable
ALTER TABLE "Category" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Category_priority_key" ON "Category"("priority");

CREATE INDEX "Category_priority_idx" ON "Category"("priority");

