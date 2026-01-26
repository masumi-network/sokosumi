/*
  Warnings:

  - You are about to drop the column `taskCommentId` on the `attachment` table. All the data in the column will be lost.
  - You are about to drop the column `taskId` on the `attachment` table. All the data in the column will be lost.
  - You are about to drop the `taskComment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `taskEvents` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `jobInputId` on table `attachment` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_taskCommentId_fkey";

-- DropForeignKey
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "taskComment" DROP CONSTRAINT "taskComment_orchestratorId_fkey";

-- DropForeignKey
ALTER TABLE "taskComment" DROP CONSTRAINT "taskComment_taskId_fkey";

-- DropForeignKey
ALTER TABLE "taskComment" DROP CONSTRAINT "taskComment_userId_fkey";

-- DropForeignKey
ALTER TABLE "taskEvents" DROP CONSTRAINT "taskEvents_orchestratorId_fkey";

-- DropForeignKey
ALTER TABLE "taskEvents" DROP CONSTRAINT "taskEvents_taskId_fkey";

-- DropForeignKey
ALTER TABLE "taskEvents" DROP CONSTRAINT "taskEvents_userId_fkey";

-- DropIndex
DROP INDEX "attachment_taskCommentId_idx";

-- DropIndex
DROP INDEX "attachment_taskId_idx";

-- AlterTable
ALTER TABLE "attachment" DROP COLUMN "taskCommentId",
DROP COLUMN "taskId",
ALTER COLUMN "jobInputId" SET NOT NULL;

-- DropTable
DROP TABLE "taskComment";

-- DropTable
DROP TABLE "taskEvents";

-- CreateTable
CREATE TABLE "taskEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "TaskStatus",
    "comment" TEXT,
    "userId" TEXT,
    "orchestratorId" TEXT,

    CONSTRAINT "taskEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taskEvent" ADD CONSTRAINT "taskEvent_orchestratorId_fkey" FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
