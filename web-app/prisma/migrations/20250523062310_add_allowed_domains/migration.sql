-- CreateTable
CREATE TABLE "allowedDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowedDomain_domain_organizationId_key" ON "allowedDomain"("domain", "organizationId");

-- AddForeignKey
ALTER TABLE "allowedDomain" ADD CONSTRAINT "allowedDomain_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
