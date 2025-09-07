/*
  Warnings:

  - Added the required column `updatedAt` to the `blob` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."BlobOrigin" AS ENUM ('INPUT', 'OUTPUT');

-- CreateEnum
CREATE TYPE "public"."BlobStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "public"."blob" ADD COLUMN     "mime" TEXT,
ADD COLUMN     "origin" "public"."BlobOrigin" NOT NULL DEFAULT 'INPUT',
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "status" "public"."BlobStatus" NOT NULL DEFAULT 'READY',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "fileUrl" DROP NOT NULL;