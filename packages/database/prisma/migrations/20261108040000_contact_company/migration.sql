-- CreateTable
CREATE TABLE "contact_company" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "website" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "headquarters" TEXT,
    "linkedinUrl" TEXT,
    "whyItMatters" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "inactiveSince" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_company_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_company_workspaceId_enrichedAt_idx" ON "contact_company"("workspaceId", "enrichedAt");

CREATE UNIQUE INDEX "contact_company_workspaceId_key_key" ON "contact_company"("workspaceId", "key");

ALTER TABLE "contact_company" ADD CONSTRAINT "contact_company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

