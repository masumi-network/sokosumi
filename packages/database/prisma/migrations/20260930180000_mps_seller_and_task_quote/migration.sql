-- CreateTable
CREATE TABLE "coworker_mps_seller" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coworkerId" TEXT NOT NULL,
    "vendorId" UUID NOT NULL,
    "network" VARCHAR(7) NOT NULL,
    "apiUrl" VARCHAR(2048) NOT NULL,
    "agentIdentifier" VARCHAR(250) NOT NULL,
    "walletId" VARCHAR(250) NOT NULL,
    "paymentSourceId" VARCHAR(250) NOT NULL,
    "apiKeyId" VARCHAR(250) NOT NULL,
    "sellerVkey" VARCHAR(56) NOT NULL,
    "walletAddress" VARCHAR(250) NOT NULL,
    "sellerReturnAddress" VARCHAR(250),
    "policyId" VARCHAR(56) NOT NULL,
    "paymentSourceType" VARCHAR(16) NOT NULL,
    "smartContractAddress" VARCHAR(250) NOT NULL,
    "supportedPaymentSourceIndex" INTEGER,
    "encryptedApiKey" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "coworker_mps_seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_mps_payment_quote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT NOT NULL,
    "sellerBindingId" TEXT NOT NULL,
    "coworkerId" TEXT NOT NULL,
    "billingOwnerId" TEXT NOT NULL,
    "billingOrganizationId" TEXT,
    "network" VARCHAR(7) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "identifierFromPurchaser" VARCHAR(26) NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "quotedTerms" JSONB,
    "blockchainIdentifierHash" VARCHAR(64),
    "termsHash" VARCHAR(64),
    "quotedCents" BIGINT,
    "maxCents" BIGINT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "quotedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "claimId" TEXT,

    CONSTRAINT "task_mps_payment_quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coworker_mps_seller_vendorId_idx" ON "coworker_mps_seller"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "coworker_mps_seller_active_uidx" ON "coworker_mps_seller"("coworkerId", "network") WHERE ("revokedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "task_mps_payment_quote_claimId_key" ON "task_mps_payment_quote"("claimId");

-- CreateIndex
CREATE INDEX "task_mps_payment_quote_sellerBindingId_idx" ON "task_mps_payment_quote"("sellerBindingId");

-- CreateIndex
CREATE UNIQUE INDEX "task_mps_payment_quote_taskId_idempotencyKey_key" ON "task_mps_payment_quote"("taskId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "task_mps_payment_quote_network_blockchainIdentifierHash_key" ON "task_mps_payment_quote"("network", "blockchainIdentifierHash");

-- CreateIndex
CREATE UNIQUE INDEX "task_mps_payment_quote_sellerBindingId_identifierFromPurcha_key" ON "task_mps_payment_quote"("sellerBindingId", "identifierFromPurchaser");

-- AddForeignKey
ALTER TABLE "coworker_mps_seller" ADD CONSTRAINT "coworker_mps_seller_coworkerId_fkey" FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_mps_payment_quote" ADD CONSTRAINT "task_mps_payment_quote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_mps_payment_quote" ADD CONSTRAINT "task_mps_payment_quote_sellerBindingId_fkey" FOREIGN KEY ("sellerBindingId") REFERENCES "coworker_mps_seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_mps_payment_quote" ADD CONSTRAINT "task_mps_payment_quote_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "task_payment_claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
