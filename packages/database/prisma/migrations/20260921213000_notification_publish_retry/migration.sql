ALTER TABLE "notification"
  ADD COLUMN "publishId" TEXT,
  ADD COLUMN "publishPush" BOOLEAN,
  ADD COLUMN "publishCreated" BOOLEAN,
  ADD COLUMN "publishQueuedAt" TIMESTAMP(3),
  ADD COLUMN "publishNextAttemptAt" TIMESTAMP(3);

CREATE INDEX CONCURRENTLY "notification_publishNextAttemptAt_idx"
  ON "notification"("publishNextAttemptAt")
  WHERE "publishNextAttemptAt" IS NOT NULL;
