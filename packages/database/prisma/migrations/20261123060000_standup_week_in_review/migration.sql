-- AlterTable
ALTER TABLE "user" ADD COLUMN "hideWeekFromStandup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "team_standup" ADD COLUMN "weekInReviewWeekday" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "weekInReviewNextRunAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "team_standup_run" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DAILY';

-- DropIndex
DROP INDEX "team_standup_run_standupId_scheduledFor_key";

-- CreateIndex
CREATE UNIQUE INDEX "team_standup_run_standupId_kind_scheduledFor_key" ON "team_standup_run"("standupId", "kind", "scheduledFor");

-- CreateIndex
CREATE INDEX "team_standup_enabled_weekInReviewNextRunAt_idx" ON "team_standup"("enabled", "weekInReviewNextRunAt");
