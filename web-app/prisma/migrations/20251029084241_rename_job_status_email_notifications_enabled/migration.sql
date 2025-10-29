/*
  Warnings:

  - You are about to drop the column `jobStatusNotificationsEnabled` on the `user` table. All the data in the column will be lost.

  Steps:
  1. Add jobStatusNotificationsOptIn as nullable
  2. Copy data from jobStatusEmailNotificationsEnabled to jobStatusNotificationsOptIn
  3. Drop jobStatusEmailNotificationsEnabled
*/
-- AlterTable
ALTER TABLE "user" ADD COLUMN "jobStatusNotificationsOptIn" BOOLEAN NOT NULL DEFAULT true;
UPDATE "user" SET "jobStatusNotificationsOptIn" = "jobStatusEmailNotificationsEnabled";
ALTER TABLE "user" DROP COLUMN "jobStatusEmailNotificationsEnabled";
