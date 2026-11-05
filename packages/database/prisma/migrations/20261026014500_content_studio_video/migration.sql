-- AlterEnum
ALTER TYPE "ProjectImageJobKind" ADD VALUE 'TEXT_TO_VIDEO';
ALTER TYPE "ProjectImageJobKind" ADD VALUE 'IMAGE_TO_VIDEO';

-- CreateEnum
CREATE TYPE "ProjectImageMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "project_image_asset" ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "mediaType" "ProjectImageMediaType" NOT NULL DEFAULT 'IMAGE';
