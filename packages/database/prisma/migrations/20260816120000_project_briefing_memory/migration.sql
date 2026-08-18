-- AlterTable
ALTER TABLE "project" RENAME COLUMN "description" TO "briefing";

ALTER TABLE "project"
ADD COLUMN "briefingUrl" TEXT,
ADD COLUMN "contextMd" TEXT,
ADD COLUMN "contextMdUrl" TEXT,
ADD COLUMN "contextMdUpdatedAt" TIMESTAMP(3),
ADD COLUMN "contextMdModel" TEXT,
ADD COLUMN "contextMdUpdatingSince" TIMESTAMP(3),
ADD COLUMN "contextMdVersion" INTEGER NOT NULL DEFAULT 0;
