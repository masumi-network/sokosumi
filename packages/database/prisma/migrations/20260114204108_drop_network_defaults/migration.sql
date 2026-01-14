-- AlterTable
ALTER TABLE "Agent" ALTER COLUMN "network" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CreditCost" ALTER COLUMN "network" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FiatTransaction" ALTER COLUMN "network" DROP DEFAULT;
