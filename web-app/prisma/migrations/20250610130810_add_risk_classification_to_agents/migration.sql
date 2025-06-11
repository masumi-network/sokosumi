-- CreateEnum
CREATE TYPE "RiskClassification" AS ENUM ('MINIMAL', 'LIMITED', 'HIGH', 'UNACCEPTABLE');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "riskClassification" "RiskClassification" NOT NULL DEFAULT 'MINIMAL';
