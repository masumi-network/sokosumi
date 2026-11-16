ALTER TABLE "project_image_job"
  ADD COLUMN "lettering" TEXT NOT NULL DEFAULT 'overlay',
  ADD COLUMN "letteringQuoteCents" BIGINT;
