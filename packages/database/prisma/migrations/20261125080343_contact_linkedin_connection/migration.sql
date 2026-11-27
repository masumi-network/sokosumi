-- CreateTable
CREATE TABLE "contact_linkedin_connection" (
    "workspaceId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "connectedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_linkedin_connection_pkey" PRIMARY KEY ("contactId","userId")
);

-- CreateIndex
CREATE INDEX "contact_linkedin_connection_workspaceId_userId_idx" ON "contact_linkedin_connection"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "contact_linkedin_connection" ADD CONSTRAINT "contact_linkedin_connection_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_linkedin_connection" ADD CONSTRAINT "contact_linkedin_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
