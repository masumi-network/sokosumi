ALTER TABLE "newsletter_sending_domain"
    ADD COLUMN "warmupStartedAt" TIMESTAMP(3),
    ADD COLUMN "warmupPausedAt" TIMESTAMP(3),
    ADD COLUMN "warmupPauseReason" TEXT,
    ADD COLUMN "warmupSentOnDayUtc" TIMESTAMP(3),
    ADD COLUMN "warmupSentCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "newsletter_send"
    ADD COLUMN "sendingDomainId" UUID,
    ADD COLUMN "attemptedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Older queued rows may already have reached the provider; retain their retry safety.
UPDATE "newsletter_send" SET "attemptedAt" = CURRENT_TIMESTAMP WHERE "status" = 'QUEUED';

ALTER TABLE "newsletter_event" ADD COLUMN "bounceType" TEXT;

CREATE INDEX "newsletter_send_issueId_status_attemptedAt_idx" ON "newsletter_send"("issueId", "status", "attemptedAt");
CREATE INDEX "newsletter_send_sendingDomainId_attemptedAt_idx" ON "newsletter_send"("sendingDomainId", "attemptedAt");

ALTER TABLE "newsletter_send" ADD CONSTRAINT "newsletter_send_sendingDomainId_fkey" FOREIGN KEY ("sendingDomainId") REFERENCES "newsletter_sending_domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;
