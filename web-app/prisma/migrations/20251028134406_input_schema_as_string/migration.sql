-- AlterTable
-- Convert JSONB to TEXT by casting the JSONB column to TEXT format
-- This ensures existing JSONB data is properly serialized as JSON strings
ALTER TABLE "Job" ALTER COLUMN "inputSchema" SET DATA TYPE TEXT USING "inputSchema"::TEXT;
