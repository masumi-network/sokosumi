-- A shared Soko Bot acting on its own charges the Organization pool with no
-- member (ADR 0057), so its usage rows carry no user.
ALTER TABLE "soko_bot_usage" ALTER COLUMN "userId" DROP NOT NULL;
