/*
  Warnings:

  - A unique constraint covering the columns `[unit,network]` on the table `CreditCost` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `network` to the `Agent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `network` to the `CreditCost` table without a default value. This is not possible if the table is not empty.
  - Added the required column `network` to the `FiatTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Network" AS ENUM ('MAINNET', 'PREPROD');

-- DropIndex
DROP INDEX "CreditCost_unit_key";

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'PREPROD';

-- AlterTable
ALTER TABLE "CreditCost" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'PREPROD';

-- AlterTable
ALTER TABLE "FiatTransaction" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'PREPROD';

-- CreateIndex
CREATE INDEX "Agent_network_idx" ON "Agent"("network");

-- CreateIndex
CREATE INDEX "Agent_blockchainIdentifier_network_idx" ON "Agent"("blockchainIdentifier", "network");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCost_unit_network_key" ON "CreditCost"("unit", "network");

-- CreateIndex
CREATE INDEX "FiatTransaction_network_idx" ON "FiatTransaction"("network");
