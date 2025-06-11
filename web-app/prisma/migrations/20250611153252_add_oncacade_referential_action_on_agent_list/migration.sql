-- DropForeignKey
ALTER TABLE "AgentList" DROP CONSTRAINT "AgentList_userId_fkey";

-- AddForeignKey
ALTER TABLE "AgentList" ADD CONSTRAINT "AgentList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
