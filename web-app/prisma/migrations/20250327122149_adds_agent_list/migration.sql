-- CreateEnum
CREATE TYPE "AgentListTypeEnum" AS ENUM ('Favorite', 'RecentlyUsed');

-- CreateTable
CREATE TABLE "AgentList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listType" "AgentListTypeEnum" NOT NULL,

    CONSTRAINT "AgentList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AgentToAgentList" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentToAgentList_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AgentToAgentList_B_index" ON "_AgentToAgentList"("B");

-- AddForeignKey
ALTER TABLE "AgentList" ADD CONSTRAINT "AgentList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToAgentList" ADD CONSTRAINT "_AgentToAgentList_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToAgentList" ADD CONSTRAINT "_AgentToAgentList_B_fkey" FOREIGN KEY ("B") REFERENCES "AgentList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
