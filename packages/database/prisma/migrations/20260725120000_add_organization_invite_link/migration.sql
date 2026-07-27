-- CreateTable
CREATE TABLE "organizationInviteLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organizationInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizationInviteLink_token_key" ON "organizationInviteLink"("token");

-- CreateIndex
CREATE INDEX "organizationInviteLink_organizationId_idx" ON "organizationInviteLink"("organizationId");

-- AddForeignKey
ALTER TABLE "organizationInviteLink" ADD CONSTRAINT "organizationInviteLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizationInviteLink" ADD CONSTRAINT "organizationInviteLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
