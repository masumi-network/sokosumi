-- CreateEnum
CREATE TYPE "ContactSuggestionStatus" AS ENUM ('SUGGESTED', 'ADDED', 'DISMISSED');

-- CreateTable
CREATE TABLE "contact_people_search" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "listId" UUID,
    "query" TEXT NOT NULL,
    "requested" INTEGER NOT NULL,
    "found" INTEGER NOT NULL DEFAULT 0,
    "chargedCents" BIGINT NOT NULL DEFAULT 0,
    "transactionId" TEXT,
    "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_people_search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_suggestion" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "listId" UUID NOT NULL,
    "searchId" UUID NOT NULL,
    "profileKey" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "organization" TEXT,
    "location" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ContactSuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "contactId" UUID,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_people_search_transactionId_key" ON "contact_people_search"("transactionId");

-- CreateIndex
CREATE INDEX "contact_people_search_listId_createdAt_idx" ON "contact_people_search"("listId", "createdAt");

-- CreateIndex
CREATE INDEX "contact_suggestion_listId_status_createdAt_idx" ON "contact_suggestion"("listId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contact_suggestion_listId_profileKey_key" ON "contact_suggestion"("listId", "profileKey");

-- AddForeignKey
ALTER TABLE "contact_people_search" ADD CONSTRAINT "contact_people_search_listId_fkey" FOREIGN KEY ("listId") REFERENCES "contact_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_suggestion" ADD CONSTRAINT "contact_suggestion_listId_fkey" FOREIGN KEY ("listId") REFERENCES "contact_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_suggestion" ADD CONSTRAINT "contact_suggestion_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "contact_people_search"("id") ON DELETE CASCADE ON UPDATE CASCADE;

