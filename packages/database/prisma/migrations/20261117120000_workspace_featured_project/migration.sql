-- AlterTable
ALTER TABLE "workspace" ADD COLUMN     "featuredProjectId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "workspace_featuredProjectId_key" ON "workspace"("featuredProjectId");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_featuredProjectId_fkey" FOREIGN KEY ("featuredProjectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
