-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('Fixed');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('Online', 'Offline', 'Deregistered', 'Invalid');

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
    "ratingId" TEXT,
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
    "onChainTags" TEXT[],
    "overrideTags" TEXT[],
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

-- CreateIndex
CREATE UNIQUE INDEX "AgentPricing_agentFixedPricingId_key" ON "AgentPricing"("agentFixedPricingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_ratingId_key" ON "Agent"("ratingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentPricingId_key" ON "Agent"("agentPricingId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_agentIdentifier_key" ON "Agent"("agentIdentifier");

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
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "AgentRating"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_agentPricingId_fkey" FOREIGN KEY ("agentPricingId") REFERENCES "AgentPricing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
