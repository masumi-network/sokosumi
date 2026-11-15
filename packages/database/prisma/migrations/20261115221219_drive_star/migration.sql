-- CreateTable
CREATE TABLE "drive_star" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "workspaceId" UUID NOT NULL,
    "resourceId" UUID,
    "folderPath" TEXT,

    CONSTRAINT "drive_star_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drive_star_workspaceId_folderPath_idx" ON "drive_star"("workspaceId", "folderPath");

-- CreateIndex
CREATE INDEX "drive_star_resourceId_idx" ON "drive_star"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_star_userId_workspaceId_resourceId_key" ON "drive_star"("userId", "workspaceId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_star_userId_workspaceId_folderPath_key" ON "drive_star"("userId", "workspaceId", "folderPath");

-- AddForeignKey
ALTER TABLE "drive_star" ADD CONSTRAINT "drive_star_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_star" ADD CONSTRAINT "drive_star_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_star" ADD CONSTRAINT "drive_star_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
