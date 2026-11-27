-- CreateTable
CREATE TABLE "fundraising_portfolio_company" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "round" TEXT,
    "date" TEXT,
    "amountUsd" INTEGER,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundraising_portfolio_company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fundraising_portfolio_company_contactId_idx" ON "fundraising_portfolio_company"("contactId");

-- CreateIndex
CREATE INDEX "fundraising_portfolio_company_workspaceId_name_idx" ON "fundraising_portfolio_company"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "fundraising_portfolio_company" ADD CONSTRAINT "fundraising_portfolio_company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_portfolio_company" ADD CONSTRAINT "fundraising_portfolio_company_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
