ALTER TABLE "project_social_connection_intent"
  ADD COLUMN "callbackRedeemedAt" TIMESTAMP(3);

ALTER TABLE "project_social_connection_audit"
  ADD COLUMN "connectedAccountId" TEXT;
