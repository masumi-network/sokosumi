-- AlterTable
ALTER TABLE "project_image_job"
    ADD COLUMN "useProductCutout" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "productCutoutChecksum" TEXT;
