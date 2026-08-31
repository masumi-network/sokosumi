ALTER TYPE "SokoBotTurnSource" ADD VALUE IF NOT EXISTS 'INGEST';

CREATE TYPE "SokoBotIntegrationStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'REVOKED');

ALTER TABLE "orchestrator"
  ADD COLUMN "ingestTimezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
  ADD COLUMN "lastBriefingAt" TIMESTAMP(3);

CREATE TABLE "soko_bot_integration" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sokoBotId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "composioAccountId" TEXT NOT NULL,
  "status" "SokoBotIntegrationStatus" NOT NULL DEFAULT 'PENDING',
  "connectedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "cursor" JSONB,
  "lastIngestAt" TIMESTAMP(3),
  CONSTRAINT "soko_bot_integration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soko_bot_integration_composioAccountId_key" ON "soko_bot_integration"("composioAccountId");
CREATE UNIQUE INDEX "soko_bot_integration_sokoBotId_provider_key" ON "soko_bot_integration"("sokoBotId", "provider");
CREATE INDEX "soko_bot_integration_status_idx" ON "soko_bot_integration"("status");

ALTER TABLE "soko_bot_integration" ADD CONSTRAINT "soko_bot_integration_sokoBotId_fkey"
  FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
