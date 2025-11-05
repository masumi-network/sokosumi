-- AlterTable
ALTER TABLE "Category" ADD COLUMN "priority" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Category_priority_key" ON "Category"("priority");
