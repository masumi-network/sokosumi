-- CreateTable
CREATE TABLE "contact_not_duplicate" (
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "otherContactId" UUID NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_not_duplicate_pkey" PRIMARY KEY ("contactId","otherContactId")
);

-- CreateIndex
CREATE INDEX "contact_not_duplicate_workspaceId_idx" ON "contact_not_duplicate"("workspaceId");

-- CreateIndex
CREATE INDEX "contact_not_duplicate_otherContactId_idx" ON "contact_not_duplicate"("otherContactId");

-- AddForeignKey
ALTER TABLE "contact_not_duplicate" ADD CONSTRAINT "contact_not_duplicate_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_not_duplicate" ADD CONSTRAINT "contact_not_duplicate_otherContactId_fkey" FOREIGN KEY ("otherContactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
