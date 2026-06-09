-- DropForeignKey
ALTER TABLE "AgentList" DROP CONSTRAINT "AgentList_userId_fkey";

-- DropForeignKey
ALTER TABLE "_AgentToAgentList" DROP CONSTRAINT "_AgentToAgentList_A_fkey";

-- DropForeignKey
ALTER TABLE "_AgentToAgentList" DROP CONSTRAINT "_AgentToAgentList_B_fkey";

-- DropTable
DROP TABLE "AgentList";

-- DropTable
DROP TABLE "_AgentToAgentList";

-- DropEnum
DROP TYPE "AgentListType";

