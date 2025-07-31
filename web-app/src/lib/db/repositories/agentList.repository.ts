import "server-only";

import { agentListInclude, AgentListWithAgents } from "@/lib/db/types";
import { AgentList, AgentListType, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export const agentListRepository = {
  async createAgentListForUserId(
    userId: string,
    type: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentListWithAgents> {
    return await tx.agentList.create({
      data: {
        userId,
        type,
      },
      include: agentListInclude,
    });
  },

  async getAgentListByUserId(
    userId: string,
    type: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentListWithAgents | null> {
    return await tx.agentList.findUnique({
      where: {
        userId_type: {
          userId,
          type,
        },
      },
      include: agentListInclude,
    });
  },

  async removeAgentFromAgentList(
    agentId: string,
    userId: string,
    listType: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentList> {
    return await tx.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { disconnect: { id: agentId } },
      },
    });
  },

  async addAgentToAgentList(
    agentId: string,
    userId: string,
    listType: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentList> {
    return await tx.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { connect: { id: agentId } },
      },
    });
  },
};
