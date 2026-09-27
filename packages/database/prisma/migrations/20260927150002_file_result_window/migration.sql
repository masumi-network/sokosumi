-- CreateEnum
CREATE TYPE "FileResultWindowKind" AS ENUM ('SEARCH', 'SELECTION');

-- CreateTable
CREATE TABLE "file_result_window" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" UUID NOT NULL,
    "kind" "FileResultWindowKind" NOT NULL,
    "actorFingerprint" TEXT NOT NULL,
    "bindingDigest" TEXT NOT NULL,
    "epochVector" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_result_window_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_result_window_workspaceId_actorFingerprint_idx" ON "file_result_window"("workspaceId", "actorFingerprint");

-- CreateIndex
CREATE INDEX "file_result_window_expiresAt_idx" ON "file_result_window"("expiresAt");

-- AddForeignKey
ALTER TABLE "file_result_window" ADD CONSTRAINT "file_result_window_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
