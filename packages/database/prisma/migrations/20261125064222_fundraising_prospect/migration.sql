-- CreateEnum
CREATE TYPE "FundraisingStage" AS ENUM ('TO_RESEARCH', 'WARM_PATH', 'REACHED_OUT', 'MEETING', 'DATA_ROOM', 'DILIGENCE', 'COMMITTED', 'PASSED');

-- CreateTable
CREATE TABLE "fundraising_prospect" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "stage" "FundraisingStage" NOT NULL DEFAULT 'TO_RESEARCH',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT,
    "ticketSize" TEXT,
    "thesis" TEXT,
    "committedUsd" INTEGER,
    "notes" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fundraising_prospect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_prospect_contactId_key" ON "fundraising_prospect"("contactId");

-- CreateIndex
CREATE INDEX "fundraising_prospect_workspaceId_stage_idx" ON "fundraising_prospect"("workspaceId", "stage");

-- AddForeignKey
ALTER TABLE "fundraising_prospect" ADD CONSTRAINT "fundraising_prospect_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_prospect" ADD CONSTRAINT "fundraising_prospect_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
