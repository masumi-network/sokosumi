ALTER TABLE "newsletter_issue"
ADD COLUMN "leaseToken" UUID,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT;

CREATE INDEX "newsletter_issue_status_leaseExpiresAt_idx"
ON "newsletter_issue"("status", "leaseExpiresAt");
