-- CreateTable
CREATE TABLE "badge_campaign" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badge_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_campaign_seen" (
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_campaign_seen_pkey" PRIMARY KEY ("userId","campaignId")
);

-- CreateIndex
CREATE INDEX "badge_campaign_startsAt_endsAt_idx" ON "badge_campaign"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "badge_campaign_feature_startsAt_idx" ON "badge_campaign"("feature", "startsAt");

-- CreateIndex
CREATE INDEX "badge_campaign_seen_campaignId_idx" ON "badge_campaign_seen"("campaignId");

-- AddForeignKey
ALTER TABLE "badge_campaign" ADD CONSTRAINT "badge_campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_campaign_seen" ADD CONSTRAINT "badge_campaign_seen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_campaign_seen" ADD CONSTRAINT "badge_campaign_seen_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "badge_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
