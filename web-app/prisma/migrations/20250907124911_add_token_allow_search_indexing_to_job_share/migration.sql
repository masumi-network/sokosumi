/*
  Warnings:

  - A unique constraint covering the columns `[token]` on the table `share` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."share" ADD COLUMN     "allowSearchIndexing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "share_token_key" ON "public"."share"("token");
