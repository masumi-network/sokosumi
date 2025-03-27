import { AgentListType, Prisma } from "@prisma/client";

import prisma from "@/lib/db/prisma";

const agentListInclude = {
  agent: true,
} as const;

export type AgentListWithAgent = Prisma.AgentListGetPayload<{
  include: typeof agentListInclude;
}>;

export async function getAgentLists(
  userId: string,
): Promise<AgentListWithAgent[]> {
  const agentLists = await prisma.agentList.findMany({
    where: { userId },
    include: agentListInclude,
    orderBy: {
      listType: "asc",
    },
  });

  if (!agentLists) {
    return [];
  }

  return agentLists;
}

export async function getAgentListByType(
  userId: string,
  listType: AgentListType,
): Promise<AgentListWithAgent | null> {
  const agentList = await prisma.agentList.findFirst({
    where: {
      userId,
      listType,
    },
    include: agentListInclude,
  });

  return agentList;
}

export async function createAgentList(
  userId: string,
  listType: AgentListType,
): Promise<AgentListWithAgent> {
  return await prisma.agentList.create({
    data: {
      userId,
      listType,
    },
    include: agentListInclude,
  });
}

export async function getOrCreateAgentListByType(
  userId: string,
  listType: AgentListType,
): Promise<AgentListWithAgent> {
  const existingList = await getAgentListByType(userId, listType);

  if (existingList) {
    return existingList;
  }

  return await createAgentList(userId, listType);
}

export async function addAgentToList(
  agentId: string,
  listId: string,
): Promise<AgentListWithAgent> {
  return await prisma.agentList.update({
    where: { id: listId },
    data: {
      agent: { connect: { id: agentId } },
    },
    include: agentListInclude,
  });
}
