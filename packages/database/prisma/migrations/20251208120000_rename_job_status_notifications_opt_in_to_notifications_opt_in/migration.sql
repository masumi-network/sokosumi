/*
  Migration: Rename jobStatusNotificationsOptIn to notificationsOptIn

  This migration renames the column from `jobStatusNotificationsOptIn` to `notificationsOptIn`.
  All existing data is preserved during this operation.
*/
-- AlterTable
ALTER TABLE "user" RENAME COLUMN "jobStatusNotificationsOptIn" TO "notificationsOptIn";

