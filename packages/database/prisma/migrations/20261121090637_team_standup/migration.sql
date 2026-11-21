-- AlterTable
ALTER TABLE "soko_bot" ADD COLUMN     "joinsTeamStandup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "soko_bot_setting" ADD COLUMN     "standupPausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "team_standup" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "roomId" UUID,
    "timeOfDay" TEXT NOT NULL DEFAULT '09:00',
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "costCapUsdMicros" BIGINT NOT NULL DEFAULT 100000,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),

    CONSTRAINT "team_standup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_standup_run" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "standupId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" UUID,
    "lines" JSONB,
    "matches" JSONB,
    "costUsdMicros" BIGINT NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "team_standup_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_standup_organizationId_key" ON "team_standup"("organizationId");

-- CreateIndex
CREATE INDEX "team_standup_enabled_nextRunAt_idx" ON "team_standup"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_standup_run_standupId_scheduledFor_key" ON "team_standup_run"("standupId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "team_standup" ADD CONSTRAINT "team_standup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_standup" ADD CONSTRAINT "team_standup_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_standup_run" ADD CONSTRAINT "team_standup_run_standupId_fkey" FOREIGN KEY ("standupId") REFERENCES "team_standup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
