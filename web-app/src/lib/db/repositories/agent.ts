import "server-only";

import {
  agentInclude,
  agentPricingInclude,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithRelations,
} from "@/lib/db/types";
import { AgentStatus, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveAgentWithRelationsById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentInclude,
  });
}

export async function retrieveAgentWithFixedPricingById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithFixedPricing | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentPricingInclude,
  });
}

export async function retrieveShownAgentsWithRelationsByStatus(
  status: AgentStatus,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await tx.agent.findMany({
    include: agentInclude,
    where: {
      status,
      isShown: true,
    },
  });
}

/**
 * NOTE:
 * this function filters the agents by the jobs that the user has hired
 * so agent.jobs must be non-empty array
 * and take one of that (latest one)
 */
export async function retrieveHiredAgentsWithJobsByUserId(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  return await tx.agent.findMany({
    where: {
      jobs: {
        some: {
          userId,
        },
      },
    },
    include: {
      jobs: {
        where: {
          userId,
        },
        orderBy: {
          startedAt: "desc",
        },
        take: 1,
      },
    },
  });
}
