-- CreateIndex
CREATE INDEX "newsletter_subscriber_newsletterId_createdAt_id_idx" ON "newsletter_subscriber"("newsletterId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "newsletter_subscriber_newsletterId_status_createdAt_id_idx" ON "newsletter_subscriber"("newsletterId", "status", "createdAt", "id");
