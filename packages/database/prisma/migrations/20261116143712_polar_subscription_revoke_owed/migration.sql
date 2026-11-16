-- AlterTable
ALTER TABLE "polar_subscription" ADD COLUMN     "revokeFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revokeOwedAt" TIMESTAMP(3);
