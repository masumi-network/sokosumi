/*
  Warnings:

  - A unique constraint covering the columns `[stripeCustomerId]` on the table `organization` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."organization" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organization_stripeCustomerId_key" ON "public"."organization"("stripeCustomerId");
