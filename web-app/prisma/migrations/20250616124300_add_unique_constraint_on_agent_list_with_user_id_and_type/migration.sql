/*
  Warnings:

  - A unique constraint covering the columns `[userId,type]` on the table `AgentList` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AgentList_userId_type_key" ON "AgentList"("userId", "type");
