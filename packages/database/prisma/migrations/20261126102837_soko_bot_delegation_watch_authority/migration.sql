-- Persist Core-owned OwnerAuthority on SokoBotDelegation and SokoBotWatch,
-- plus durable shared grantId spend ledger (SokoBotAuthoritySpend).

-- AlterTable
ALTER TABLE "soko_bot_delegation" ADD COLUMN "authority" JSONB;

-- AlterTable
ALTER TABLE "soko_bot_watch" ADD COLUMN "authority" JSONB;

-- CreateTable
CREATE TABLE "soko_bot_authority_spend" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "grantId" TEXT NOT NULL,
    "operationKey" TEXT,
    "turnId" UUID NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "images" INTEGER NOT NULL DEFAULT 0,
    "videos" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',

    CONSTRAINT "soko_bot_authority_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_authority_spend_operationKey_key" ON "soko_bot_authority_spend"("operationKey");

-- CreateIndex
CREATE INDEX "soko_bot_authority_spend_sokoBotId_grantId_status_idx" ON "soko_bot_authority_spend"("sokoBotId", "grantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_authority_spend_turnId_toolCallId_key" ON "soko_bot_authority_spend"("turnId", "toolCallId");

-- AddForeignKey
ALTER TABLE "soko_bot_authority_spend" ADD CONSTRAINT "soko_bot_authority_spend_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_authority_spend" ADD CONSTRAINT "soko_bot_authority_spend_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soko_bot_authority_spend" ADD CONSTRAINT "soko_bot_authority_spend_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
