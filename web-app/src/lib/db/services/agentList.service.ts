"use server";

import prisma from "@/lib/db/prisma";
import {
  agentListInclude,
  AgentListWithAgent,
} from "@/lib/db/types/agentList.types";
import { AgentList, AgentListType, Prisma } from "@/prisma/generated/client";

export async function getAgentLists(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent[]> {
  const agentLists = await tx.agentList.findMany({
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

export async function getOrCreateFavoriteAgentList(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent> {
  return await getOrCreateAgentListByType(userId, AgentListType.FAVORITE, tx);
}

export async function getOrCreateAgentListByType(
  userId: string,
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
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
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent[]> {
  // Get all existing lists for the user that match the requested types
  const existingLists = await tx.agentList.findMany({
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
      tx.agentList.create({
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
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id: listId },
    data: {
      agents: { connect: { id: agentId } },
    },
  });
}

export async function removeAgentFromList(
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
