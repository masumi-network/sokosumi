-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('Fixed');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('Online', 'Offline', 'Deregistered', 'Invalid');

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
    "ratingId" TEXT NOT NULL,
    "onChainName" TEXT NOT NULL,
    "overrideName" TEXT,
    "onChainDescription" TEXT,
    "overrideDescription" TEXT,
    "onChainApiBaseUrl" TEXT NOT NULL,
    "overrideApiBaseUrl" TEXT,
    "onChainExampleOutput" TEXT,
    "overrideExampleOutput" TEXT,
    "onChainCapabilityName" TEXT NOT NULL,
    "overrideCapabilityName" TEXT,
    "onChainCapabilityVersion" TEXT NOT NULL,
    "overrideCapabilityVersion" TEXT,
    "onChainRequestsPerHour" TEXT,
    "overrideRequestsPerHour" TEXT,
    "onChainAuthorName" TEXT NOT NULL,
    "overrideAuthorName" TEXT,
    "onChainAuthorContactEmail" TEXT,
    "overrideAuthorContactEmail" TEXT,
    "onChainAuthorContactOther" TEXT,
    "overrideAuthorContactOther" TEXT,
    "onChainAuthorOrganization" TEXT,
    "overrideAuthorOrganization" TEXT,
    "onChainLegalPrivacyPolicy" TEXT,
    "overrideLegalPrivacyPolicy" TEXT,
    "onChainLegalTerms" TEXT,
    "overrideLegalTerms" TEXT,
    "onChainLegalOther" TEXT,
    "overrideLegalOther" TEXT,
    "onChainImage" TEXT NOT NULL,
    "overrideImage" TEXT,
    "onChainMetadataVersion" INTEGER NOT NULL,
    "overrideMetadataVersion" INTEGER,
    "agentPricingId" TEXT NOT NULL,
    "agentIdentifier" TEXT NOT NULL,
    "status" "Status" NOT NULL,
    "showOnFrontPage" BOOLEAN NOT NULL,
    "ranking" BIGINT NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "_AgentOnChainTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentOnChainTag_AB_pkey" PRIMARY KEY ("A","B")
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
CREATE UNIQUE INDEX "Agent_ratingId_key" ON "Agent"("ratingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentPricingId_key" ON "Agent"("agentPricingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentIdentifier_key" ON "Agent"("agentIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "_AgentOnChainTag_B_index" ON "_AgentOnChainTag"("B");

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
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_agentPricingId_fkey" FOREIGN KEY ("agentPricingId") REFERENCES "AgentPricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentOnChainTag" ADD CONSTRAINT "_AgentOnChainTag_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentOnChainTag" ADD CONSTRAINT "_AgentOnChainTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentTagOverride" ADD CONSTRAINT "_AgentTagOverride_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentTagOverride" ADD CONSTRAINT "_AgentTagOverride_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
