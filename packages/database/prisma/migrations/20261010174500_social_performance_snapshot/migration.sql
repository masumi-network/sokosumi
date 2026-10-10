-- CreateTable
CREATE TABLE "social_performance_snapshot" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "metrics" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "profileFetchedAt" TIMESTAMP(3),

    CONSTRAINT "social_performance_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_performance_snapshot_connectionId_date_key" ON "social_performance_snapshot"("connectionId", "date");

-- CreateIndex
CREATE INDEX "social_account_post_connectionId_fetchedAt_idx" ON "social_account_post"("connectionId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "social_performance_snapshot" ADD CONSTRAINT "social_performance_snapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "project_social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
