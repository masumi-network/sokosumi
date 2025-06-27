import "server-only";

import prisma from "@/lib/db/prisma";
import { AgentList, AgentListType, Prisma } from "@/prisma/generated/client";

import { agentListInclude, AgentListWithAgent } from "./types";

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
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id: listId, userId },
    data: {
      agents: { connect: { id: agentId } },
    },
  });
}

export async function removeAgentFromAgentList(
  agentId: string,
  listId: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id: listId, userId },
    data: {
      agents: { disconnect: { id: agentId } },
    },
  });
}
