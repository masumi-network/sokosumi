-- AlterTable
ALTER TABLE "seo_audit" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
