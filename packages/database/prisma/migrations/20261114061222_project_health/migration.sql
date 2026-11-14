-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK');

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "health" "ProjectHealth",
ADD COLUMN     "healthNote" TEXT,
ADD COLUMN     "healthSetAt" TIMESTAMP(3),
ADD COLUMN     "healthSetByUserId" TEXT;

-- CreateIndex
CREATE INDEX "project_healthSetByUserId_idx" ON "project"("healthSetByUserId");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_healthSetByUserId_fkey" FOREIGN KEY ("healthSetByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

