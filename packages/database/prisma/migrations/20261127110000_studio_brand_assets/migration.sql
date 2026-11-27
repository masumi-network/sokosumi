SET lock_timeout = '5s';
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "studioBrandAssets" JSONB;
ALTER TABLE "project_image_job" ADD COLUMN IF NOT EXISTS "brandReferenceCount" INTEGER NOT NULL DEFAULT 0;
RESET lock_timeout;
