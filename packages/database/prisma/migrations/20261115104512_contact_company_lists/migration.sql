-- CreateTable
CREATE TABLE "contact_company_list" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdBySokoBotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_company_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_company_list_member" (
    "listId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "addedByUserId" TEXT,
    "addedBySokoBotId" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_company_list_member_pkey" PRIMARY KEY ("listId","companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_company_list_workspaceId_nameKey_key" ON "contact_company_list"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "contact_company_list_member_companyId_idx" ON "contact_company_list_member"("companyId");

-- AddForeignKey
ALTER TABLE "contact_company_list" ADD CONSTRAINT "contact_company_list_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_company_list_member" ADD CONSTRAINT "contact_company_list_member_listId_fkey" FOREIGN KEY ("listId") REFERENCES "contact_company_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_company_list_member" ADD CONSTRAINT "contact_company_list_member_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "contact_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
