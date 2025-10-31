-- CreateEnum
CREATE TYPE "public"."PaymentType" AS ENUM ('WEB3_CARDANO_V1', 'NONE', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."PricingType" ADD VALUE 'FREE';
ALTER TYPE "public"."PricingType" ADD VALUE 'UNKNOWN';

-- AlterTable
ALTER TABLE "public"."Agent" ADD COLUMN     "paymentType" "public"."PaymentType" NOT NULL DEFAULT 'WEB3_CARDANO_V1';
