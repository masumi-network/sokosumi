-- CreateTable
CREATE TABLE "_AgentBlacklist" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentBlacklist_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AgentBlacklist_B_index" ON "_AgentBlacklist"("B");

-- AddForeignKey
ALTER TABLE "_AgentBlacklist" ADD CONSTRAINT "_AgentBlacklist_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentBlacklist" ADD CONSTRAINT "_AgentBlacklist_B_fkey" FOREIGN KEY ("B") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
