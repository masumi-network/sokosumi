-- AlterTable
ALTER TABLE "Agent" ALTER COLUMN "network" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CreditCost" ALTER COLUMN "network" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CreditTransaction" ALTER COLUMN "network" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "network" DROP DEFAULT;

-- AlterTable
ALTER TABLE "jobSchedule" ALTER COLUMN "network" DROP DEFAULT;
