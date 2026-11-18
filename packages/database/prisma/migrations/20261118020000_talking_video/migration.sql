-- AlterEnum
ALTER TYPE "ProjectImageJobKind" ADD VALUE 'TALKING_VIDEO';

-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN     "voiceBlobPathname" TEXT,
ADD COLUMN     "pendingMediaUrl" TEXT,
ADD COLUMN     "presenterConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "project_image_asset" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false;
