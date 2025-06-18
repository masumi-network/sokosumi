"use server";

import { agentListInclude, AgentListWithAgent, prisma } from "@/lib/db";
import { AgentList, AgentListType, Prisma } from "@/prisma/generated/client";

export async function createAgentList(
  userId: string,
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent> {
  return await tx.agentList.create({
    data: {
      userId,
      type,
    },
    include: agentListInclude,
  });
}

export async function getAgentListByType(
  userId: string,
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent | null> {
  const agentList = await tx.agentList.findFirst({
    where: {
      userId,
      type,
    },
    include: agentListInclude,
  });

  return agentList;
}

export async function getAgentListsByTypes(
  userId: string,
  types: AgentListType[],
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent[]> {
  return await tx.agentList.findMany({
    where: { userId, type: { in: types } },
    include: agentListInclude,
  });
}

export async function addAgentToAgentList(
  agentId: string,
  listId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id: listId },
    data: {
      agents: { connect: { id: agentId } },
    },
  });
}

export async function removeAgentFromAgentList(
  agentId: string,
  listId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id: listId },
    data: {
      agents: { disconnect: { id: agentId } },
    },
  });
}
