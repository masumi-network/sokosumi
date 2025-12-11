/*
  Warnings:

  - You are about to drop the column `externalId` on the `jobInput` table. All the data in the column will be lost.
  - You are about to drop the column `inputSchema` on the `jobInput` table. All the data in the column will be lost.
  - You are about to drop the column `jobId` on the `jobInput` table. All the data in the column will be lost.
  - You are about to drop the column `inputId` on the `jobStatus` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[statusId]` on the table `jobInput` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `statusId` to the `jobInput` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "jobInput" DROP CONSTRAINT "jobInput_jobId_fkey";

-- DropForeignKey
ALTER TABLE "jobStatus" DROP CONSTRAINT "jobStatus_inputId_fkey";

-- DropIndex
DROP INDEX "jobInput_externalId_idx";

-- DropIndex
DROP INDEX "jobInput_jobId_idx";

-- DropIndex
DROP INDEX "jobStatus_inputId_key";

-- AlterTable
ALTER TABLE "jobInput" DROP COLUMN "externalId",
DROP COLUMN "inputSchema",
DROP COLUMN "jobId",
ADD COLUMN     "statusId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "jobStatus" DROP COLUMN "inputId";

-- CreateIndex
CREATE UNIQUE INDEX "jobInput_statusId_key" ON "jobInput"("statusId");

-- AddForeignKey
ALTER TABLE "jobInput" ADD CONSTRAINT "jobInput_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "jobStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
