-- CreateTable
CREATE TABLE "AgentMetadataOverride" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "apiBaseUrl" TEXT,
    "capabilityName" TEXT,
    "capabilityVersion" TEXT,
    "authorName" TEXT,
    "authorImage" TEXT,
    "authorContactEmail" TEXT,
    "authorContactOther" TEXT,
    "authorOrganization" TEXT,
    "legalPrivacyPolicy" TEXT,
    "legalDpa" TEXT,
    "legalTerms" TEXT,
    "legalOther" TEXT,
    "image" TEXT,

    CONSTRAINT "AgentMetadataOverride_pkey" PRIMARY KEY ("id")
);

-- Migrate scalar overrides and ensure rows exist when only tags/examples were overridden
INSERT INTO "AgentMetadataOverride" (
    "id",
    "createdAt",
    "updatedAt",
    "agentId",
    "name",
    "description",
    "apiBaseUrl",
    "capabilityName",
    "capabilityVersion",
    "authorName",
    "authorImage",
    "authorContactEmail",
    "authorContactOther",
    "authorOrganization",
    "legalPrivacyPolicy",
    "legalDpa",
    "legalTerms",
    "legalOther",
    "image"
)
SELECT
    gen_random_uuid()::text,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    a."id",
    a."overrideName",
    a."overrideDescription",
    a."overrideApiBaseUrl",
    a."overrideCapabilityName",
    a."overrideCapabilityVersion",
    a."overrideAuthorName",
    a."overrideAuthorImage",
    a."overrideAuthorContactEmail",
    a."overrideAuthorContactOther",
    a."overrideAuthorOrganization",
    a."overrideLegalPrivacyPolicy",
    a."overrideLegalDpa",
    a."overrideLegalTerms",
    a."overrideLegalOther",
    a."overrideImage"
FROM "Agent" a
WHERE
    a."overrideName" IS NOT NULL
    OR a."overrideDescription" IS NOT NULL
    OR a."overrideApiBaseUrl" IS NOT NULL
    OR a."overrideCapabilityName" IS NOT NULL
    OR a."overrideCapabilityVersion" IS NOT NULL
    OR a."overrideAuthorName" IS NOT NULL
    OR a."overrideAuthorImage" IS NOT NULL
    OR a."overrideAuthorContactEmail" IS NOT NULL
    OR a."overrideAuthorContactOther" IS NOT NULL
    OR a."overrideAuthorOrganization" IS NOT NULL
    OR a."overrideLegalPrivacyPolicy" IS NOT NULL
    OR a."overrideLegalDpa" IS NOT NULL
    OR a."overrideLegalTerms" IS NOT NULL
    OR a."overrideLegalOther" IS NOT NULL
    OR a."overrideImage" IS NOT NULL
    OR EXISTS (
        SELECT 1
        FROM "_AgentTagOverride" ato
        WHERE ato."A" = a."id"
    )
    OR EXISTS (
        SELECT 1
        FROM "ExampleOutput" eo
        WHERE eo."agentIdOverride" = a."id"
    );

-- CreateTable
CREATE TABLE "_AgentMetadataOverrideToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentMetadataOverrideToTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- Migrate override tag relations
INSERT INTO "_AgentMetadataOverrideToTag" ("A", "B")
SELECT amo."id", ato."B"
FROM "_AgentTagOverride" ato
INNER JOIN "AgentMetadataOverride" amo ON amo."agentId" = ato."A";

-- AlterTable
ALTER TABLE "ExampleOutput" ADD COLUMN "metadataOverrideId" TEXT;

-- Migrate override example outputs
UPDATE "ExampleOutput" eo
SET "metadataOverrideId" = amo."id"
FROM "AgentMetadataOverride" amo
WHERE eo."agentIdOverride" = amo."agentId";

-- DropForeignKey
ALTER TABLE "ExampleOutput" DROP CONSTRAINT "ExampleOutput_agentIdOverride_fkey";

-- DropForeignKey
ALTER TABLE "_AgentTagOverride" DROP CONSTRAINT "_AgentTagOverride_A_fkey";

-- DropForeignKey
ALTER TABLE "_AgentTagOverride" DROP CONSTRAINT "_AgentTagOverride_B_fkey";

-- DropTable
DROP TABLE "_AgentTagOverride";

-- AlterTable
ALTER TABLE "ExampleOutput" DROP COLUMN "agentIdOverride";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "overrideName",
DROP COLUMN "overrideDescription",
DROP COLUMN "overrideApiBaseUrl",
DROP COLUMN "overrideCapabilityName",
DROP COLUMN "overrideCapabilityVersion",
DROP COLUMN "overrideAuthorName",
DROP COLUMN "overrideAuthorImage",
DROP COLUMN "overrideAuthorContactEmail",
DROP COLUMN "overrideAuthorContactOther",
DROP COLUMN "overrideAuthorOrganization",
DROP COLUMN "overrideLegalPrivacyPolicy",
DROP COLUMN "overrideLegalDpa",
DROP COLUMN "overrideLegalTerms",
DROP COLUMN "overrideLegalOther",
DROP COLUMN "overrideImage";

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetadataOverride_agentId_key" ON "AgentMetadataOverride"("agentId");

-- CreateIndex
CREATE INDEX "_AgentMetadataOverrideToTag_B_index" ON "_AgentMetadataOverrideToTag"("B");

-- AddForeignKey
ALTER TABLE "AgentMetadataOverride" ADD CONSTRAINT "AgentMetadataOverride_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExampleOutput" ADD CONSTRAINT "ExampleOutput_metadataOverrideId_fkey" FOREIGN KEY ("metadataOverrideId") REFERENCES "AgentMetadataOverride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentMetadataOverrideToTag" ADD CONSTRAINT "_AgentMetadataOverrideToTag_A_fkey" FOREIGN KEY ("A") REFERENCES "AgentMetadataOverride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentMetadataOverrideToTag" ADD CONSTRAINT "_AgentMetadataOverrideToTag_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
