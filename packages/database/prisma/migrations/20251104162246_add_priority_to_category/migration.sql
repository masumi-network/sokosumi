-- AlterTable
ALTER TABLE "Category" ADD COLUMN "priority" INTEGER;

-- CreateIndex
CREATE INDEX "Category_priority_idx" ON "Category"("priority");
