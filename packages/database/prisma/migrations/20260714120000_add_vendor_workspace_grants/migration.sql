-- CreateEnum
CREATE TYPE "VendorPermission" AS ENUM ('task:read', 'task:comment', 'task:create');

-- CreateEnum
CREATE TYPE "VendorGrantStatus" AS ENUM ('PENDING', 'GRANTED', 'DENIED', 'REVOKED');

-- CreateTable
CREATE TABLE "vendor_grant" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "permission" "VendorPermission" NOT NULL,
    "status" "VendorGrantStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "requestedByUserId" TEXT,

    CONSTRAINT "vendor_grant_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "task" ADD COLUMN "pendingVendorGrantId" UUID;

-- CreateIndex
CREATE INDEX "vendor_grant_workspaceId_status_idx" ON "vendor_grant"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_grant_vendorId_workspaceId_permission_key" ON "vendor_grant"("vendorId", "workspaceId", "permission");

-- CreateIndex
CREATE INDEX "task_pendingVendorGrantId_idx" ON "task"("pendingVendorGrantId");

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_grant" ADD CONSTRAINT "vendor_grant_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_pendingVendorGrantId_fkey" FOREIGN KEY ("pendingVendorGrantId") REFERENCES "vendor_grant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
