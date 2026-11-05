-- AlterTable
ALTER TABLE "contact" ADD COLUMN     "enrichedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contact_capture_state" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "backfillFloor" TIMESTAMP(3) NOT NULL,
    "backfillCompletedAt" TIMESTAMP(3),
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_capture_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_capture_state_integrationId_key" ON "contact_capture_state"("integrationId");

-- CreateIndex
CREATE INDEX "contact_capture_state_lastRunAt_idx" ON "contact_capture_state"("lastRunAt");

-- CreateIndex
CREATE INDEX "contact_workspaceId_enrichedAt_idx" ON "contact"("workspaceId", "enrichedAt");

-- AddForeignKey
ALTER TABLE "contact_capture_state" ADD CONSTRAINT "contact_capture_state_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "soko_bot_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

