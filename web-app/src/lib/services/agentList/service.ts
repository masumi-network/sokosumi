import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { AgentListWithAgent } from "@/lib/db";
import {
  createAgentListByUserIdAndType,
  prisma,
  retrieveAgentListByUserIdAndType,
  retrieveMembersOrganizationIdsByUserId,
} from "@/lib/db/repositories";
import { canUserAccessAgent } from "@/lib/services";
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
    const userOrganizationIds = await retrieveMembersOrganizationIdsByUserId(
      session.user.id,
      tx,
    );

    existingList.agents = existingList.agents.filter((agent) =>
      canUserAccessAgent(agent, userOrganizationIds),
    );
    return existingList;
  }

  return await createAgentListByUserIdAndType(session.user.id, type, tx);
}
