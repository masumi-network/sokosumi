-- CreateEnum
CREATE TYPE "TaskLinkType" AS ENUM ('RELATES', 'BLOCKS', 'PARENT', 'DUPLICATE');

-- CreateTable
CREATE TABLE "task_link" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "type" "TaskLinkType" NOT NULL,
    "note" TEXT,

    CONSTRAINT "task_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_link_fromTaskId_idx" ON "task_link"("fromTaskId");

-- CreateIndex
CREATE INDEX "task_link_toTaskId_idx" ON "task_link"("toTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_link_fromTaskId_toTaskId_type_key" ON "task_link"("fromTaskId", "toTaskId", "type");

-- AddForeignKey
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_link" ADD CONSTRAINT "task_link_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
