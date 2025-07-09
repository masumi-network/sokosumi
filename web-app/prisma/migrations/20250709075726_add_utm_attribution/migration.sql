-- CreateTable
CREATE TABLE "utmAttribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utmAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utmAttribution_userId_key" ON "utmAttribution"("userId");

-- CreateIndex
CREATE INDEX "utmAttribution_utmSource_utmMedium_utmCampaign_idx" ON "utmAttribution"("utmSource", "utmMedium", "utmCampaign");

-- CreateIndex
CREATE INDEX "utmAttribution_capturedAt_idx" ON "utmAttribution"("capturedAt");

-- CreateIndex
CREATE INDEX "utmAttribution_convertedAt_idx" ON "utmAttribution"("convertedAt");

-- AddForeignKey
ALTER TABLE "utmAttribution" ADD CONSTRAINT "utmAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
