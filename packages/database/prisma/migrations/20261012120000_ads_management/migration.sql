-- CreateTable
CREATE TABLE "project_ad_connection" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "composioConnectedAccountId" TEXT NOT NULL,
    "connectorUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ad_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_ad_account" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "loginCustomerId" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timeZone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ad_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_ad_market_profile" (
    "projectId" UUID NOT NULL,
    "keywords" TEXT[],
    "locationCode" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_ad_market_profile_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "project_ad_market_snapshot" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_ad_market_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_ad_connection_composioConnectedAccountId_key" ON "project_ad_connection"("composioConnectedAccountId");

-- CreateIndex
CREATE INDEX "project_ad_connection_projectId_idx" ON "project_ad_connection"("projectId");

-- CreateIndex
CREATE INDEX "project_ad_account_connectionId_idx" ON "project_ad_account"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "project_ad_account_projectId_provider_externalAccountId_key" ON "project_ad_account"("projectId", "provider", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "project_ad_market_snapshot_projectId_kind_requestKey_key" ON "project_ad_market_snapshot"("projectId", "kind", "requestKey");

-- AddForeignKey
ALTER TABLE "project_ad_connection" ADD CONSTRAINT "project_ad_connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ad_account" ADD CONSTRAINT "project_ad_account_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ad_account" ADD CONSTRAINT "project_ad_account_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "project_ad_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ad_market_profile" ADD CONSTRAINT "project_ad_market_profile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_ad_market_snapshot" ADD CONSTRAINT "project_ad_market_snapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
