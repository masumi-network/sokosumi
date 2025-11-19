/*
  Warnings:

  - You are about to drop the column `completedAt` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `input` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `inputHash` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `inputSchema` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `output` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `resultHash` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `startedAt` on the `Job` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Job" DROP COLUMN "completedAt",
DROP COLUMN "input",
DROP COLUMN "inputHash",
DROP COLUMN "inputSchema",
DROP COLUMN "output",
DROP COLUMN "startedAt";
