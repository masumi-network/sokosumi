ALTER TABLE "project" ADD COLUMN "studioBrandAssets" JSONB;
ALTER TABLE "project_image_job" ADD COLUMN "brandReferenceCount" INTEGER NOT NULL DEFAULT 0;
