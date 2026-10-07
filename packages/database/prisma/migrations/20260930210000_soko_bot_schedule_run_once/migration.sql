-- One-time Soko Bot schedules: fire once at nextRunAt, then disable.
ALTER TABLE "soko_bot_schedule" ADD COLUMN "runOnce" BOOLEAN NOT NULL DEFAULT false;
