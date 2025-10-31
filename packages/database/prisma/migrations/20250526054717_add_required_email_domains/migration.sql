-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "requiredEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
