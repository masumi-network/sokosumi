-- AlterTable
ALTER TABLE "contact_company" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
