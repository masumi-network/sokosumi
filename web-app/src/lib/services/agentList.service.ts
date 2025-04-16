"use server";

import {
  AgentListWithAgent,
  createAgentList,
  getAgentListByType,
  getAgentListsByTypes,
  prisma,
} from "@/lib/db";
import { AgentListType, Prisma } from "@/prisma/generated/client";

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

export async function getOrCreateFavoriteAgentList(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent> {
  return await getOrCreateAgentListByType(userId, AgentListType.FAVORITE, tx);
}

export async function getFavoriteAgents(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const list = await getOrCreateFavoriteAgentList(userId, tx);
  return list.agents;
}

export async function getOrCreateAgentListsByTypes(
  userId: string,
  types: AgentListType[],
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent[]> {
  // Get all existing lists for the user that match the requested types
  const existingLists = await getAgentListsByTypes(userId, types, tx);

  // Find which types are missing
  const existingTypes = new Set(existingLists.map((list) => list.type));
  const missingTypes = types.filter((type) => !existingTypes.has(type));

  // Create missing lists
  const newLists = await Promise.all(
    missingTypes.map((type) => createAgentList(userId, type, tx)),
  );

  // Combine existing and new lists, sorted by type
  return [...existingLists, ...newLists].sort((a, b) =>
    a.type.localeCompare(b.type),
  );
}
