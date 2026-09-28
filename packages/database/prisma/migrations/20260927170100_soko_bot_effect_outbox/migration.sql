-- Reordered after main's migration prefix. Fresh installs run the original DDL.
-- A branch preview may already have applied the former name. Recognize only its
-- exact successful checksum; never rewrite migration history or replay its DDL
-- over later feature migrations (which may have removed indexes).
DO $soko_migration$
BEGIN
  -- Prisma shadow replay has no migration history table.
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20260926204445_soko_bot_effect_outbox') THEN
      IF EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260926204445_soko_bot_effect_outbox'
          AND checksum = '406f5cbaa44912ba3223fb443784fa3eca209666dfe7aca1193e906b01614643'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260926204445_soko_bot_effect_outbox'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL
          AND checksum <> '406f5cbaa44912ba3223fb443784fa3eca209666dfe7aca1193e906b01614643'
      ) THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'Former migration 20260926204445_soko_bot_effect_outbox is not an exact successful application; reconcile without changing its history';
    END IF;
  END IF;

-- AlterTable
ALTER TABLE "soko_bot_delegation" ADD COLUMN     "lastSeenEventAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "soko_bot_effect_outbox" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SokoBotDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCategory" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "soko_bot_effect_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "soko_bot_effect_outbox_status_nextAttemptAt_idx" ON "soko_bot_effect_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_effect_outbox_receiptId_purpose_key" ON "soko_bot_effect_outbox"("receiptId", "purpose");

-- AddForeignKey
ALTER TABLE "soko_bot_effect_outbox" ADD CONSTRAINT "soko_bot_effect_outbox_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "soko_bot_tool_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

END
$soko_migration$;
