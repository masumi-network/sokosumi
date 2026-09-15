-- AlterTable
ALTER TABLE "social_post" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "social_post_publish_attempt" (
    "id" UUID NOT NULL,
    "socialPostId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "errorKind" TEXT,
    "providerOutcome" TEXT,
    "toolSlug" TEXT,
    "externalId" TEXT,

    CONSTRAINT "social_post_publish_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_post_publish_attempt_socialPostId_startedAt_idx" ON "social_post_publish_attempt"("socialPostId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_publish_attempt_socialPostId_attempt_key" ON "social_post_publish_attempt"("socialPostId", "attempt");

-- CreateIndex
CREATE INDEX "social_post_status_nextAttemptAt_idx" ON "social_post"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "social_post_publish_attempt" ADD CONSTRAINT "social_post_publish_attempt_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

