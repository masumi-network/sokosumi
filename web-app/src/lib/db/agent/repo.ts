"use server";

import { prisma } from "@/lib/db";
import { AgentStatus, Prisma } from "@/prisma/generated/client";

import {
  agentInclude,
  agentPricingInclude,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithRelations,
} from "./types";

/**
 * Get all agents that are online and shown
 */
export async function getOnlineAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await getAgentsWithStatus(AgentStatus.ONLINE, tx);
}

export async function getOnlineAgentsWithValidCreditCostUnits(
  tx: Prisma.TransactionClient = prisma,
  validCreditCostUnits: string[],
): Promise<AgentWithRelations[]> {
  const onlineAgents = await getOnlineAgents(tx);
  return onlineAgents.filter((agent) => {
    const amounts = agent.pricing.fixedPricing?.amounts?.map((amount) => ({
      unit: amount.unit,
      amount: Number(amount.amount),
    }));
    if (!amounts) {
      return true;
    }
    return amounts.every(({ unit }) => validCreditCostUnits.includes(unit));
  });
}

async function getAgentsWithStatus(
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

export async function getAgentById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentInclude,
  });
}

export async function getAgentByIdWithPricing(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithFixedPricing | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentPricingInclude,
  });
}

/**
 * NOTE:
 * this function filters the agents by the jobs that the user has hired
 * so agent.jobs must be non-empty array
 * and take one of that (latest one)
 */
export async function getHiredAgents(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  return await tx.agent.findMany({
    where: {
      jobs: {
        some: {
          userId: userId,
        },
      },
    },
    include: {
      jobs: {
        where: {
          userId: userId,
        },
        orderBy: {
          startedAt: "desc",
        },
        take: 1,
      },
    },
  });
}
