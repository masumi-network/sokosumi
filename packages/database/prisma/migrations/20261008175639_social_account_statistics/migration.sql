ALTER TABLE "project_social_connection" ADD COLUMN "statistics" JSONB;

CREATE TABLE "social_account_post" (
  "id" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "externalId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "url" TEXT,
  "metrics" JSONB NOT NULL,
  "additionalMetrics" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_account_post_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_account_post_connectionId_externalId_key" ON "social_account_post"("connectionId", "externalId");
CREATE INDEX "social_account_post_connectionId_publishedAt_id_idx" ON "social_account_post"("connectionId", "publishedAt", "id");
ALTER TABLE "social_account_post" ADD CONSTRAINT "social_account_post_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "project_social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
