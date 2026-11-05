-- CreateEnum
CREATE TYPE "DriveShareKind" AS ENUM ('FILE', 'FOLDER');

-- CreateTable
CREATE TABLE "drive_share" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceScope" "FileSourceScope" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "DriveShareKind" NOT NULL,
    "resourceId" UUID,
    "folderPath" TEXT,
    "passwordHash" TEXT,
    "failedUnlocks" INTEGER NOT NULL DEFAULT 0,
    "unlockLockedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "drive_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drive_share_token_key" ON "drive_share"("token");

-- CreateIndex
CREATE UNIQUE INDEX "drive_share_resourceId_key" ON "drive_share"("resourceId");

-- CreateIndex
CREATE INDEX "drive_share_workspaceId_sourceScope_ownerId_idx" ON "drive_share"("workspaceId", "sourceScope", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_share_workspaceId_sourceScope_ownerId_folderPath_key" ON "drive_share"("workspaceId", "sourceScope", "ownerId", "folderPath");

-- AddForeignKey
ALTER TABLE "drive_share" ADD CONSTRAINT "drive_share_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_share" ADD CONSTRAINT "drive_share_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

