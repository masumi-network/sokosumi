-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'MISSED', 'CANCELED');

-- CreateTable
CREATE TABLE "social_post" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "socialConnectionId" UUID,
    "provider" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT,
    "creatorUserId" TEXT,
    "creatorCoworkerId" TEXT,
    "creatorSokoBotId" UUID,
    "scheduledByUserId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedExternalId" TEXT,
    "publishedUrl" TEXT,
    "lastError" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "social_post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_post_projectId_status_scheduledAt_idx" ON "social_post"("projectId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_post_status_scheduledAt_idx" ON "social_post"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_post_workspaceId_scheduledAt_idx" ON "social_post"("workspaceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "social_post_socialConnectionId_idx" ON "social_post"("socialConnectionId");

-- CreateIndex
CREATE INDEX "social_post_creatorUserId_idx" ON "social_post"("creatorUserId");

-- CreateIndex
CREATE INDEX "social_post_creatorCoworkerId_idx" ON "social_post"("creatorCoworkerId");

-- CreateIndex
CREATE INDEX "social_post_creatorSokoBotId_idx" ON "social_post"("creatorSokoBotId");

-- CreateIndex
CREATE INDEX "social_post_scheduledByUserId_idx" ON "social_post"("scheduledByUserId");

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES "project_social_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_creatorCoworkerId_fkey" FOREIGN KEY ("creatorCoworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_creatorSokoBotId_fkey" FOREIGN KEY ("creatorSokoBotId") REFERENCES "soko_bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_scheduledByUserId_fkey" FOREIGN KEY ("scheduledByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Exactly one creator FK is set (mirrors task_creator_exactly_one_check).
-- Creator FKs are RESTRICT (not SET NULL): nulling one would violate this check.
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_creator_exactly_one_check" CHECK (
  (
    ("creatorUserId" IS NOT NULL)::int
    + ("creatorCoworkerId" IS NOT NULL)::int
    + ("creatorSokoBotId" IS NOT NULL)::int
  ) = 1
);
