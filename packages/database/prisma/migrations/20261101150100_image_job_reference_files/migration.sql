-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN     "referenceFileIds" UUID[] DEFAULT ARRAY[]::UUID[];
