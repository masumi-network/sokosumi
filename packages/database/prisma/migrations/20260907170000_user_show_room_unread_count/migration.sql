-- Show room unread count: opt in to a numeric Room unread on chat sidebar rows (SOK-978).
-- Defaults false, so no reader's sidebar changes on upgrade. Display only: it does
-- not touch notification delivery, which stays on notificationsOptIn and pushOptIn.

ALTER TABLE "user" ADD COLUMN "showRoomUnreadCount" BOOLEAN NOT NULL DEFAULT false;
