-- AlterTable
ALTER TABLE "buzz_identity" ADD COLUMN "appPubkey" TEXT,
ADD COLUMN "pendingAppPubkey" TEXT,
ADD COLUMN "pendingAppSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "buzz_message_link" ADD COLUMN "signerPubkey" TEXT;

-- AlterTable
ALTER TABLE "buzz_reaction_link" ADD COLUMN "signerPubkey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "buzz_identity_appPubkey_key" ON "buzz_identity"("appPubkey");
