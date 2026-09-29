-- SOK-1090: records the email sent for a notification on the row itself.
-- "emailId" is the Resend id, set on the one row the email was sent for, so a
-- later unread row about the same thing finds it there and sees the reader was
-- already told.
-- "emailScheduledAt" is when a held email leaves Resend; null for one sent at
-- once. A row read before that instant cancels its email by id.

-- AlterTable
ALTER TABLE "notification" ADD COLUMN "emailId" TEXT,
ADD COLUMN "emailScheduledAt" TIMESTAMP(3);
