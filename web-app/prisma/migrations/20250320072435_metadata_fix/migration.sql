/*
  Warnings:

  - You are about to drop the column `onChainMetadataVersion` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `overrideMetadataVersion` on the `Agent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "onChainMetadataVersion",
DROP COLUMN "overrideMetadataVersion",
ADD COLUMN     "metadataVersion" INTEGER NOT NULL DEFAULT 1;
