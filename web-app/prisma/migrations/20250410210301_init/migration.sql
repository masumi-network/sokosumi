-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('FIXED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEREGISTERED', 'INVALID');

-- CreateEnum
CREATE TYPE "AgentListType" AS ENUM ('FAVORITE');

-- CreateEnum
CREATE TYPE "FiatTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FiatService" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_FAILED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUND_REQUESTED', 'DISPUTED', 'REFUNDED', 'REFUND_FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "twoFactorEnabled" BOOLEAN,
    "role" TEXT,
    "banned" BOOLEAN,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "stripeCustomerId" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "impersonatedBy" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "teamId" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "count" INTEGER,
    "lastRequest" BIGINT,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitValue" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unit" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "agentFixedPricingId" TEXT,
    "paymentRequestId" TEXT,
    "purchaseRequestId" TEXT,

    CONSTRAINT "UnitValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPricing" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pricingType" "PricingType" NOT NULL,
    "agentFixedPricingId" TEXT,

    CONSTRAINT "AgentPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentFixedPricing" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFixedPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExampleOutput" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "agentId" TEXT,
    "agentIdOverride" TEXT,

    CONSTRAINT "ExampleOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAgentRating" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stars" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "UserAgentRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRating" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "totalStars" BIGINT NOT NULL,
    "totalRatings" BIGINT NOT NULL,

    CONSTRAINT "AgentRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockchainIdentifier" TEXT NOT NULL,
    "ratingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "overrideName" TEXT,
    "description" TEXT,
    "overrideDescription" TEXT,
    "apiBaseUrl" TEXT NOT NULL,
    "overrideApiBaseUrl" TEXT,
    "capabilityName" TEXT NOT NULL,
    "overrideCapabilityName" TEXT,
    "capabilityVersion" TEXT NOT NULL,
    "overrideCapabilityVersion" TEXT,
    "authorName" TEXT NOT NULL,
    "overrideAuthorName" TEXT,
    "authorContactEmail" TEXT,
    "overrideAuthorContactEmail" TEXT,
    "authorContactOther" TEXT,
    "overrideAuthorContactOther" TEXT,
    "authorOrganization" TEXT,
    "overrideAuthorOrganization" TEXT,
    "legalPrivacyPolicy" TEXT,
    "overrideLegalPrivacyPolicy" TEXT,
    "legalTerms" TEXT,
    "overrideLegalTerms" TEXT,
    "legalOther" TEXT,
    "overrideLegalOther" TEXT,
    "lastUptimeCheck" TIMESTAMP(3) NOT NULL,
    "uptimeCount" INTEGER NOT NULL,
    "uptimeCheckCount" INTEGER NOT NULL,
    "image" TEXT NOT NULL,
    "overrideImage" TEXT,
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "pricingId" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ONLINE',
    "isShown" BOOLEAN NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lock" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,

    CONSTRAINT "Lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AgentListType" NOT NULL,

    CONSTRAINT "AgentList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "includedFee" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "noteKey" TEXT,
    "errorNote" TEXT,
    "errorNoteKey" TEXT,
    "userId" TEXT NOT NULL,
    "fiatTransactionId" TEXT,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiatTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "credits" BIGINT NOT NULL,
    "servicePaymentId" TEXT,
    "service" "FiatService" NOT NULL DEFAULT 'STRIPE',
    "status" "FiatTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT NOT NULL,
    "creditTransactionId" TEXT,

    CONSTRAINT "FiatTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentJobId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorNote" TEXT,
    "errorNoteKey" TEXT,
    "blockchainIdentifier" TEXT NOT NULL,
    "submitResultTime" TIMESTAMP(3),
    "unlockTime" TIMESTAMP(3),
    "externalDisputeUnlockTime" TIMESTAMP(3),
    "sellerVkey" TEXT,
    "identifierFromPurchaser" TEXT,
    "creditTransactionId" TEXT NOT NULL,
    "refundedCreditTransactionId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCost" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "unit" TEXT NOT NULL,
    "creditCostPerUnit" BIGINT NOT NULL,

    CONSTRAINT "CreditCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AgentToAgentList" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentToAgentList_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AgentTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AgentTagOverride" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentTagOverride_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPricing_agentFixedPricingId_key" ON "AgentPricing"("agentFixedPricingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_blockchainIdentifier_key" ON "Agent"("blockchainIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_ratingId_key" ON "Agent"("ratingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_pricingId_key" ON "Agent"("pricingId");

-- CreateIndex
CREATE INDEX "Agent_blockchainIdentifier_idx" ON "Agent"("blockchainIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Lock_key_key" ON "Lock"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_fiatTransactionId_key" ON "CreditTransaction"("fiatTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FiatTransaction_servicePaymentId_key" ON "FiatTransaction"("servicePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "FiatTransaction_creditTransactionId_key" ON "FiatTransaction"("creditTransactionId");

-- CreateIndex
CREATE INDEX "FiatTransaction_servicePaymentId_idx" ON "FiatTransaction"("servicePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_blockchainIdentifier_key" ON "Job"("blockchainIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Job_creditTransactionId_key" ON "Job"("creditTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_refundedCreditTransactionId_key" ON "Job"("refundedCreditTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCost_unit_key" ON "CreditCost"("unit");

-- CreateIndex
CREATE INDEX "_AgentToAgentList_B_index" ON "_AgentToAgentList"("B");

-- CreateIndex
CREATE INDEX "_AgentTag_B_index" ON "_AgentTag"("B");

-- CreateIndex
CREATE INDEX "_AgentTagOverride_B_index" ON "_AgentTagOverride"("B");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitValue" ADD CONSTRAINT "UnitValue_agentFixedPricingId_fkey" FOREIGN KEY ("agentFixedPricingId") REFERENCES "AgentFixedPricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPricing" ADD CONSTRAINT "AgentPricing_agentFixedPricingId_fkey" FOREIGN KEY ("agentFixedPricingId") REFERENCES "AgentFixedPricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExampleOutput" ADD CONSTRAINT "ExampleOutput_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExampleOutput" ADD CONSTRAINT "ExampleOutput_agentIdOverride_fkey" FOREIGN KEY ("agentIdOverride") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgentRating" ADD CONSTRAINT "UserAgentRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgentRating" ADD CONSTRAINT "UserAgentRating_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "AgentRating"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "AgentPricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentList" ADD CONSTRAINT "AgentList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiatTransaction" ADD CONSTRAINT "FiatTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiatTransaction" ADD CONSTRAINT "FiatTransaction_creditTransactionId_fkey" FOREIGN KEY ("creditTransactionId") REFERENCES "CreditTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_creditTransactionId_fkey" FOREIGN KEY ("creditTransactionId") REFERENCES "CreditTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_refundedCreditTransactionId_fkey" FOREIGN KEY ("refundedCreditTransactionId") REFERENCES "CreditTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToAgentList" ADD CONSTRAINT "_AgentToAgentList_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToAgentList" ADD CONSTRAINT "_AgentToAgentList_B_fkey" FOREIGN KEY ("B") REFERENCES "AgentList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentTag" ADD CONSTRAINT "_AgentTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentTag" ADD CONSTRAINT "_AgentTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentTagOverride" ADD CONSTRAINT "_AgentTagOverride_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentTagOverride" ADD CONSTRAINT "_AgentTagOverride_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
