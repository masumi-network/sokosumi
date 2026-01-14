/*
  Warnings:

  - Added the required column `network` to the `Agent` table with a default value of 'MAINNET'.
  - Added the required column `network` to the `CreditCost` table with a default value of 'MAINNET'.
  - Added the required column `network` to the `FiatTransaction` table with a default value of 'MAINNET'.

*/
-- CreateEnum
CREATE TYPE "Network" AS ENUM ('MAINNET', 'PREPROD');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'MAINNET';

-- AlterTable
ALTER TABLE "CreditCost" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'MAINNET';

-- AlterTable
ALTER TABLE "FiatTransaction" ADD COLUMN     "network" "Network" NOT NULL DEFAULT 'MAINNET';
