"use server";

import { UnAuthorizedError } from "@/lib/auth/errors";
import { getAuthenticatedUser } from "@/lib/auth/utils";
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
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new UnAuthorizedError();
  }
  const userId = user.id;

  const existingList = await getAgentListByType(userId, type, tx);

  if (existingList) {
    return existingList;
  }

  return await createAgentList(userId, type, tx);
}
