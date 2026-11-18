-- CreateEnum
CREATE TYPE "TrackedCompetitorSource" AS ENUM ('RESEARCH', 'MEMBER');

-- CreateEnum
CREATE TYPE "CompetitorPageKind" AS ENUM ('WEBSITE', 'PRICING');

-- CreateEnum
CREATE TYPE "CompetitorSignalKind" AS ENUM ('WEBSITE_CHANGE', 'PRICE_CHANGE', 'NEWS', 'AD', 'SOCIAL');

-- CreateTable
CREATE TABLE "tracked_competitor" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "researchKey" TEXT,
    "websiteUrl" TEXT,
    "pricingUrl" TEXT,
    "instagramHandle" TEXT,
    "facebookHandle" TEXT,
    "source" "TrackedCompetitorSource" NOT NULL,
    "memberEditedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "tracked_competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_page_snapshot" (
    "id" UUID NOT NULL,
    "competitorId" UUID NOT NULL,
    "kind" "CompetitorPageKind" NOT NULL,
    "url" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_page_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_signal" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competitorId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "CompetitorSignalKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "sourcePublisher" TEXT,
    "quote" TEXT,
    "raw" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "competitor_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_check" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "competitorCount" INTEGER NOT NULL DEFAULT 0,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "sources" JSONB,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chargedCents" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "competitor_check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracked_competitor_projectId_removedAt_idx" ON "tracked_competitor"("projectId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_competitor_projectId_nameKey_key" ON "tracked_competitor"("projectId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_page_snapshot_competitorId_kind_key" ON "competitor_page_snapshot"("competitorId", "kind");

-- CreateIndex
CREATE INDEX "competitor_signal_projectId_observedAt_idx" ON "competitor_signal"("projectId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_signal_competitorId_dedupeKey_key" ON "competitor_signal"("competitorId", "dedupeKey");

-- CreateIndex
CREATE INDEX "competitor_check_projectId_createdAt_idx" ON "competitor_check"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_check_projectId_day_key" ON "competitor_check"("projectId", "day");

-- AddForeignKey
ALTER TABLE "tracked_competitor" ADD CONSTRAINT "tracked_competitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_page_snapshot" ADD CONSTRAINT "competitor_page_snapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "tracked_competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_signal" ADD CONSTRAINT "competitor_signal_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "tracked_competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_signal" ADD CONSTRAINT "competitor_signal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_check" ADD CONSTRAINT "competitor_check_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

