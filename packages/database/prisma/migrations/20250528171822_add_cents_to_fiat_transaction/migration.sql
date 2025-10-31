-- AlterTable
ALTER TABLE "FiatTransaction" ADD COLUMN     "cents" BIGINT NOT NULL DEFAULT 0,
ALTER COLUMN "centsPerAmount" DROP NOT NULL;
