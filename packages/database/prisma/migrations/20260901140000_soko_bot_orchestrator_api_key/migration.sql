-- CreateTable
CREATE TABLE "orchestrator_api_key" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyStart" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "sokoBotId" UUID NOT NULL,

    CONSTRAINT "orchestrator_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orchestrator_api_key_keyHash_key" ON "orchestrator_api_key"("keyHash");

-- CreateIndex
CREATE INDEX "orchestrator_api_key_sokoBotId_idx" ON "orchestrator_api_key"("sokoBotId");

-- CreateIndex
CREATE INDEX "orchestrator_api_key_revokedAt_expiresAt_idx" ON "orchestrator_api_key"("revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "orchestrator_api_key" ADD CONSTRAINT "orchestrator_api_key_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "orchestrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
