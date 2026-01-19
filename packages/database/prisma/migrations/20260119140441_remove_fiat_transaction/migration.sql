/*
  Warnings:

  - You are about to drop the `FiatTransaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `errorNote` on the `CreditTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `errorNoteKey` on the `CreditTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `note` on the `CreditTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `noteKey` on the `CreditTransaction` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[referenceId,referenceType]` on the table `CreditTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "FiatTransaction" DROP CONSTRAINT "FiatTransaction_creditTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "FiatTransaction" DROP CONSTRAINT "FiatTransaction_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "FiatTransaction" DROP CONSTRAINT "FiatTransaction_userId_fkey";

-- DropIndex
DROP INDEX "FiatTransaction_servicePaymentId_key";

-- DropIndex
DROP INDEX "FiatTransaction_creditTransactionId_key";

-- DropIndex
DROP INDEX "FiatTransaction_userId_organizationId_idx";

-- DropTable
DROP TABLE "FiatTransaction";

-- AlterTable
ALTER TABLE "CreditTransaction" DROP COLUMN "note",
DROP COLUMN "noteKey",
DROP COLUMN "errorNote",
DROP COLUMN "errorNoteKey";

-- CreateEnum
DO $$ BEGIN
 CREATE TYPE "CreditTransactionReferenceType" AS ENUM('STRIPE_SESSION', 'STRIPE_INVOICE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN "referenceId" TEXT,
ADD COLUMN "referenceType" "CreditTransactionReferenceType";

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_referenceId_referenceType_key" ON "CreditTransaction"("referenceId", "referenceType");

-- DropEnum
DROP TYPE "FiatTransactionStatus";

-- DropEnum
DROP TYPE "FiatService";
