-- CreateTable
CREATE TABLE "competitor_feed" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "checkDay" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "openQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authorTurnId" UUID,

    CONSTRAINT "competitor_feed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_feed_projectId_createdAt_idx" ON "competitor_feed"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_feed_projectId_checkDay_key" ON "competitor_feed"("projectId", "checkDay");

-- AddForeignKey
ALTER TABLE "competitor_feed" ADD CONSTRAINT "competitor_feed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
