-- CreateTable
CREATE TABLE "push_device_consent" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revocationCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_device_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_device_registration" (
    "channel" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "consentId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "push_device_registration_pkey" PRIMARY KEY ("channel","deviceId")
);

-- CreateIndex
CREATE INDEX "push_device_consent_userId_channel_idx" ON "push_device_consent"("userId", "channel");

-- CreateIndex
CREATE INDEX "push_device_registration_consentId_idx" ON "push_device_registration"("consentId");

-- AddForeignKey
ALTER TABLE "push_device_consent" ADD CONSTRAINT "push_device_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_device_registration" ADD CONSTRAINT "push_device_registration_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "push_device_consent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

