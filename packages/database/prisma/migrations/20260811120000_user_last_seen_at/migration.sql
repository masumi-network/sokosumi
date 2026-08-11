-- Tracks the last time a user opened the app shell, so /chat can summarise
-- what happened "while you were gone". Null until the first visit.
ALTER TABLE "user" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
