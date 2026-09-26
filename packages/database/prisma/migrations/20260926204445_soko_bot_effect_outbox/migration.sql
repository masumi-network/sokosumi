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
