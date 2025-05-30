"use server";

import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  AgentListWithAgent,
  createAgentList,
  getAgentListByType,
  prisma,
} from "@/lib/db";
import { Agent, AgentListType, Prisma } from "@/prisma/generated/client";

export async function getFavoriteAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<Agent[]> {
  const list = await getOrCreateFavoriteAgentList(tx);
  return list.agents;
}

export async function getOrCreateFavoriteAgentList(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent> {
  return await getOrCreateAgentListByType(AgentListType.FAVORITE, tx);
}

export async function getOrCreateAgentListByType(
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent> {
  const session = await getSessionOrThrow();
  const existingList = await getAgentListByType(session.user.id, type, tx);

  if (existingList) {
    return existingList;
  }

  return await createAgentList(session.user.id, type, tx);
}
