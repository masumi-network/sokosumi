-- Push opt-in: explicit consent for OS banners while Sokosumi is closed (SOK-873).
-- Defaults false; email consent stays on notificationsOptIn.

ALTER TABLE "user" ADD COLUMN "pushOptIn" BOOLEAN NOT NULL DEFAULT false;
