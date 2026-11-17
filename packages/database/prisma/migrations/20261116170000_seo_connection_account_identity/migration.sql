-- AlterTable
ALTER TABLE "seo_connection" ADD COLUMN     "accountCheckedAt" TIMESTAMP(3),
ADD COLUMN     "accountEmail" TEXT,
ADD COLUMN     "accountName" TEXT,
ADD COLUMN     "accountPictureUrl" TEXT;
