-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN     "settleLeaseAt" TIMESTAMP(3),
ADD COLUMN     "settleLeaseOwner" TEXT,
ADD COLUMN     "unreachableSince" TIMESTAMP(3),
ADD COLUMN     "unreachableSource" TEXT;
