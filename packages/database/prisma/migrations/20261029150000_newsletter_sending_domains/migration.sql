-- CreateEnum
CREATE TYPE "NewsletterSendingDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "newsletter_sending_domain" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "resendDomainId" TEXT NOT NULL,
    "status" "NewsletterSendingDomainStatus" NOT NULL DEFAULT 'PENDING',
    "dnsRecords" JSONB NOT NULL DEFAULT '[]',
    "lastCheckedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "newsletter_sending_domain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_sending_domain_workspaceId_key" ON "newsletter_sending_domain"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_sending_domain_domain_key" ON "newsletter_sending_domain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_sending_domain_resendDomainId_key" ON "newsletter_sending_domain"("resendDomainId");

-- AddForeignKey
ALTER TABLE "newsletter_sending_domain" ADD CONSTRAINT "newsletter_sending_domain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

