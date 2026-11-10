-- AlterTable
ALTER TABLE "project" ADD COLUMN "studioLogoPosition" TEXT;

ALTER TABLE "project" ADD CONSTRAINT "project_studio_logo_position_check"
CHECK ("studioLogoPosition" IN ('top-left', 'top-right', 'bottom-left', 'bottom-right'));
