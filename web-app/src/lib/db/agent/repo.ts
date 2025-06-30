import "server-only";

import { getEnvSecrets } from "@/config/env.config";
import prisma from "@/lib/db/prisma";
import { Agent, AgentStatus, Prisma } from "@/prisma/generated/client";

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

export async function getAgentApiBaseUrl(agent: Agent): Promise<URL> {
  // Validate the API base URL
  const blacklistedHostnames = getEnvSecrets().BLACKLISTED_AGENT_HOSTNAMES;
  const apiBaseUrl = new URL(agent.apiBaseUrl);
  if (blacklistedHostnames.includes(apiBaseUrl.hostname)) {
    throw new Error("Agent API base URL is not allowed");
  }
  if (apiBaseUrl.protocol !== "https:" && apiBaseUrl.protocol !== "http:") {
    throw new Error("Agent API base URL must be HTTP or HTTPS");
  }

  if (apiBaseUrl.search !== "") {
    throw new Error("Agent API base URL must not have a query string");
  }
  if (apiBaseUrl.hash !== "") {
    throw new Error("Agent API base URL must not have a hash");
  }

  const usedUrl = agent.overrideApiBaseUrl ?? agent.apiBaseUrl;
  const cleanedUrl = usedUrl.endsWith("/") ? usedUrl.slice(0, -1) : usedUrl;
  return new URL(cleanedUrl);
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
