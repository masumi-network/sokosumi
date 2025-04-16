"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@/prisma/generated/client";

import {
  agentInclude,
  agentPricingInclude,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithRelations,
} from "./types";

export async function getAgents(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await tx.agent.findMany({
    include: agentInclude,
    where: {
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
