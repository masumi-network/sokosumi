-- CreateTable
CREATE TABLE "contact_project" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "role" TEXT,
    "addedByUserId" TEXT,
    "addedBySokoBotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_project_projectId_idx" ON "contact_project"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_project_contactId_projectId_key" ON "contact_project"("contactId", "projectId");

-- AddForeignKey
ALTER TABLE "contact_project" ADD CONSTRAINT "contact_project_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_project" ADD CONSTRAINT "contact_project_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
