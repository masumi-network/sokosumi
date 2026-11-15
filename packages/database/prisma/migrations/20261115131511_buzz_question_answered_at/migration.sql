ALTER TABLE "buzz_message_link" ADD COLUMN "answeredAt" TIMESTAMP(3);
-- Questions linked before this were answered or given up on: not asked again.
UPDATE "buzz_message_link" SET "answeredAt" = CURRENT_TIMESTAMP;
