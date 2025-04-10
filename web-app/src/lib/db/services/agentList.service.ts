"use server";

import prisma from "@/lib/db/prisma";
import {
  agentListInclude,
  AgentListWithAgent,
} from "@/lib/db/types/agentList.types";
import { AgentList, AgentListType, Prisma } from "@/prisma/generated/client";

export async function getAgentLists(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<AgentListWithAgent[]> {
  const agentLists = await (tx ?? prisma).agentList.findMany({
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
  tx?: Prisma.TransactionClient,
): Promise<AgentListWithAgent | null> {
  const agentList = await (tx ?? prisma).agentList.findFirst({
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
  tx?: Prisma.TransactionClient,
): Promise<AgentListWithAgent> {
  return await (tx ?? prisma).agentList.create({
    data: {
      userId,
      type,
    },
    include: agentListInclude,
  });
}

export async function getOrCreateFavoriteAgentList(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<AgentListWithAgent> {
  return await getOrCreateAgentListByType(userId, AgentListType.FAVORITE, tx);
}

export async function getOrCreateAgentListByType(
  userId: string,
  type: AgentListType,
  tx?: Prisma.TransactionClient,
): Promise<AgentListWithAgent> {
  const existingList = await getAgentListByType(userId, type, tx);

  if (existingList) {
    return existingList;
  }

  return await createAgentList(userId, type, tx);
}

export async function getOrCreateAgentListsByTypes(
  userId: string,
  types: AgentListType[],
  tx?: Prisma.TransactionClient,
): Promise<AgentListWithAgent[]> {
  // Get all existing lists for the user that match the requested types
  const existingLists = await (tx ?? prisma).agentList.findMany({
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
      (tx ?? prisma).agentList.create({
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
  tx?: Prisma.TransactionClient,
): Promise<AgentList> {
  return await (tx ?? prisma).agentList.update({
    where: { id: listId },
    data: {
      agents: { connect: { id: agentId } },
    },
  });
}

export async function removeAgentFromList(
  agentId: string,
  listId: string,
  tx?: Prisma.TransactionClient,
): Promise<AgentList> {
  return await (tx ?? prisma).agentList.update({
    where: { id: listId },
    data: {
      agents: { disconnect: { id: agentId } },
    },
  });
}
