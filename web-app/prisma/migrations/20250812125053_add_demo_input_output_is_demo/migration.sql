-- AlterTable
ALTER TABLE "public"."Agent"
  ADD COLUMN "demoInput" TEXT,
  ADD COLUMN "demoOutput" TEXT;

-- AlterTable
ALTER TABLE "public"."Job"
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false; 