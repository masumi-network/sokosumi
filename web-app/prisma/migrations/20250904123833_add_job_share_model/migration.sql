-- CreateEnum
CREATE TYPE "public"."ShareAccessType" AS ENUM ('PUBLIC', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "public"."SharePermission" AS ENUM ('READ', 'WRITE');

-- CreateTable
CREATE TABLE "public"."share" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "accessType" "public"."ShareAccessType" NOT NULL,
    "permission" "public"."SharePermission" NOT NULL DEFAULT 'READ',
    "recipientId" TEXT,
    "recipientOrganizationId" TEXT,

    CONSTRAINT "share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_jobId_recipientId_key" ON "public"."share"("jobId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "share_jobId_recipientOrganizationId_key" ON "public"."share"("jobId", "recipientOrganizationId");

-- AddForeignKey
ALTER TABLE "public"."share" ADD CONSTRAINT "share_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."share" ADD CONSTRAINT "share_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."share" ADD CONSTRAINT "share_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."share" ADD CONSTRAINT "share_recipientOrganizationId_fkey" FOREIGN KEY ("recipientOrganizationId") REFERENCES "public"."organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add single recipient constraint
ALTER TABLE "public"."share" ADD CONSTRAINT "single_recipient_constraint" 
CHECK (
  NOT ("recipientId" IS NOT NULL AND "recipientOrganizationId" IS NOT NULL)
);