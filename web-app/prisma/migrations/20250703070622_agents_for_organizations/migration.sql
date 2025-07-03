-- CreateTable
CREATE TABLE "_AgentToOrganization" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentToOrganization_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AgentToOrganization_B_index" ON "_AgentToOrganization"("B");

-- AddForeignKey
ALTER TABLE "_AgentToOrganization" ADD CONSTRAINT "_AgentToOrganization_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToOrganization" ADD CONSTRAINT "_AgentToOrganization_B_fkey" FOREIGN KEY ("B") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
