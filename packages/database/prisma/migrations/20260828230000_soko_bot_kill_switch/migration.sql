-- Administrator kill switch. A database flag rather than an environment
-- variable so switching the feature off takes effect immediately, without a
-- redeploy, at the moment it is usually needed most.
ALTER TABLE "soko_bot_setting" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "soko_bot_setting" ADD COLUMN "disabledByUserId" TEXT;
ALTER TABLE "soko_bot_setting" ADD COLUMN "disabledReason" TEXT;
