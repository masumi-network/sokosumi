-- AlterTable
ALTER TABLE "soko_bot_integration" ADD COLUMN     "pendingComposioAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_integration_pendingComposioAccountId_key" ON "soko_bot_integration"("pendingComposioAccountId");
