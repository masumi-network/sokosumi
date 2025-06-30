import "server-only";

import { agentListInclude, AgentListWithAgent } from "@/lib/db/types";
import { AgentList, AgentListType, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function createAgentListByUserIdAndType(
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

export async function retrieveAgentListByUserIdAndType(
  userId: string,
  type: AgentListType,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent | null> {
  const agentList = await tx.agentList.findUnique({
    where: {
      userId_type: {
        userId,
        type,
      },
    },
    include: agentListInclude,
  });

  return agentList;
}

export async function retrieveAgentListsByUserIdAndTypes(
  userId: string,
  types: AgentListType[],
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentListWithAgent[]> {
  return await tx.agentList.findMany({
    where: { userId, type: { in: types } },
    include: agentListInclude,
  });
}

export async function addAgentToAgentListByIdAndUserId(
  agentId: string,
  id: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id, userId },
    data: {
      agents: { connect: { id: agentId } },
    },
  });
}

export async function removeAgentFromAgentListByIdAndUserId(
  agentId: string,
  id: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentList> {
  return await tx.agentList.update({
    where: { id, userId },
    data: {
      agents: { disconnect: { id: agentId } },
    },
  });
}
