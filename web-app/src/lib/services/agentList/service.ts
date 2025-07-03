import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { AgentListWithAgent } from "@/lib/db";
import {
  createAgentListByUserIdAndType,
  prisma,
  retrieveAgentListByUserIdAndType,
} from "@/lib/db/repositories";
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
  const existingList = await retrieveAgentListByUserIdAndType(
    session.user.id,
    type,
    tx,
  );

  if (existingList) {
    return existingList;
  }

  return await createAgentListByUserIdAndType(session.user.id, type, tx);
}
