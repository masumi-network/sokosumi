/*
  Warnings:

  - You are about to drop the column `onChainRequestsPerHour` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `overrideRequestsPerHour` on the `Agent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "onChainRequestsPerHour",
DROP COLUMN "overrideRequestsPerHour";
