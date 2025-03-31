import { AgentList, AgentListType, Prisma } from "@prisma/client";

import prisma from "@/lib/db/prisma";

const agentListInclude = {
  agents: true,
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
      type: "asc",
    },
  });

  if (!agentLists) {
    return [];
  }

  return agentLists;
}

export async function getAgentListByType(
  userId: string,
  type: AgentListType,
): Promise<AgentListWithAgent | null> {
  const agentList = await prisma.agentList.findFirst({
    where: {
      userId,
      type,
    },
    include: agentListInclude,
  });

  return agentList;
}

export async function createAgentList(
  userId: string,
  type: AgentListType,
): Promise<AgentListWithAgent> {
  return await prisma.agentList.create({
    data: {
      userId,
      type,
    },
    include: agentListInclude,
  });
}

export async function getOrCreateFavoriteAgentList(
  userId: string,
): Promise<AgentListWithAgent> {
  return await getOrCreateAgentListByType(userId, AgentListType.FAVORITE);
}

export async function getOrCreateAgentListByType(
  userId: string,
  type: AgentListType,
): Promise<AgentListWithAgent> {
  const existingList = await getAgentListByType(userId, type);

  if (existingList) {
    return existingList;
  }

  return await createAgentList(userId, type);
}

export async function getOrCreateAgentListsByTypes(
  userId: string,
  types: AgentListType[],
): Promise<AgentListWithAgent[]> {
  // Get all existing lists for the user that match the requested types
  const existingLists = await prisma.agentList.findMany({
    where: {
      userId,
      type: {
        in: types,
      },
    },
    include: agentListInclude,
  });

  // Find which types are missing
  const existingTypes = new Set(existingLists.map((list) => list.type));
  const missingTypes = types.filter((type) => !existingTypes.has(type));

  // Create missing lists
  const newLists = await Promise.all(
    missingTypes.map((type) =>
      prisma.agentList.create({
        data: {
          userId,
          type,
        },
        include: agentListInclude,
      }),
    ),
  );

  // Combine existing and new lists, sorted by type
  return [...existingLists, ...newLists].sort((a, b) =>
    a.type.localeCompare(b.type),
  );
}

export async function addAgentToList(
  agentId: string,
  listId: string,
): Promise<AgentList> {
  return await prisma.agentList.update({
    where: { id: listId },
    data: {
      agents: { connect: { id: agentId } },
    },
  });
}

export async function removeAgentFromList(
  agentId: string,
  listId: string,
): Promise<AgentList> {
  return await prisma.agentList.update({
    where: { id: listId },
    data: {
      agents: { disconnect: { id: agentId } },
    },
  });
}
