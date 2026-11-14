-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK');

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "health" "ProjectHealth",
ADD COLUMN     "healthNote" TEXT,
ADD COLUMN     "healthSetAt" TIMESTAMP(3),
ADD COLUMN     "healthSetByName" TEXT;
