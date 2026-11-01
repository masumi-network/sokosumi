-- CreateEnum
CREATE TYPE "SocialCommentStatus" AS ENUM ('NEW', 'REPLIED', 'SKIPPED', 'OWNER');

-- CreateTable
CREATE TABLE "social_comment" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "socialPostId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalCommentId" TEXT NOT NULL,
    "authorName" TEXT,
    "authorExternalId" TEXT,
    "text" TEXT NOT NULL,
    "commentedAt" TIMESTAMP(3),
    "status" "SocialCommentStatus" NOT NULL DEFAULT 'NEW',
    "reply" TEXT,
    "replyExternalId" TEXT,
    "note" TEXT,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "social_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_comment_projectId_status_idx" ON "social_comment"("projectId", "status");

-- CreateIndex
CREATE INDEX "social_comment_socialPostId_idx" ON "social_comment"("socialPostId");

-- CreateIndex
CREATE UNIQUE INDEX "social_comment_provider_externalCommentId_key" ON "social_comment"("provider", "externalCommentId");

-- AddForeignKey
ALTER TABLE "social_comment" ADD CONSTRAINT "social_comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comment" ADD CONSTRAINT "social_comment_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
