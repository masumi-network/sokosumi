-- AlterTable
ALTER TABLE "project"
ADD COLUMN "latestUpdateMd" TEXT,
ADD COLUMN "latestUpdateMdUpdatedAt" TIMESTAMP(3);
