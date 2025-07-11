import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import {
  agentInclude,
  agentOrderBy,
  agentOrganizationsInclude,
  agentPricingInclude,
  AgentWithFixedPricing,
  AgentWithJobs,
  AgentWithOrganizations,
  AgentWithRelations,
} from "@/lib/db/types";
import { AgentStatus, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Fetch a single agent by ID with all related entities (pricing, tags, outputs, ratings, etc).
 *
 * @param id - Agent unique identifier
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Agent with all relations, or null if not found
 */
export async function retrieveAgentWithRelationsById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  const agent = await tx.agent.findUnique({
    where: { id },
    include: agentInclude,
  });

  if (!agent) {
    return null;
  }

  return mapAgentWithIsNew(agent);
}

/**
 * Fetch a single agent by ID with only organization-related data.
 * Optimized for access control scenarios.
 *
 * @param id - Agent unique identifier
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Agent with organization data, or null if not found
 */
export async function retrieveAgentWithOrganizationsById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithOrganizations | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentOrganizationsInclude,
  });
}

/**
 * Fetch a single agent by ID with only fixed pricing information.
 * Optimized for pricing-only queries.
 *
 * @param id - Agent unique identifier
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Agent with fixed pricing data, or null if not found
 */
export async function retrieveAgentWithFixedPricingById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithFixedPricing | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentPricingInclude,
  });
}

/**
 * Fetch a single agent by ID, only if it is shown and matches the given status.
 * Includes all related entities.
 *
 * @param agentId - Agent unique identifier
 * @param status - Required agent status
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Agent with relations, or null if not found
 */
export async function retrieveShownAgentWithRelationById(
  agentId: string,
  status: AgentStatus,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  const agent = await tx.agent.findUnique({
    where: { id: agentId, isShown: true, status },
    include: agentInclude,
  });

  if (!agent) {
    return null;
  }

  return mapAgentWithIsNew(agent);
}

/**
 * Fetch all agents with all related entities.
 *
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Array of agents with relations
 */
export async function retrieveAgentsWithRelations(
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  const agents = await tx.agent.findMany({
    include: agentInclude,
  });

  return agents.map(mapAgentWithIsNew);
}

/**
 * Fetch all agents that are marked as shown and have a specific status.
 * Results are sorted by jobs count (descending) and include all related entities.
 *
 * @param status - Required agent status
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Array of shown agents with relations
 */
export async function retrieveShownAgentsWithRelationsByStatus(
  status: AgentStatus,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  const agents = await tx.agent.findMany({
    include: agentInclude,
    orderBy: [...agentOrderBy],
    where: {
      status,
      isShown: true,
    },
  });

  return agents.map(mapAgentWithIsNew);
}

/**
 * Fetch all agents that have jobs for a specific user and organization context.
 * Each agent includes only the latest job for that user/org.
 *
 * @param userId - User unique identifier
 * @param organizationId - Organization unique identifier (null for personal jobs)
 * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
 * @returns Array of agents with their latest job for the user/org
 */
export async function retrieveHiredAgentsWithJobsByUserIdAndOrganization(
  userId: string,
  organizationId: string | null | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithJobs[]> {
  const normalizedOrganizationId = organizationId ?? null;
  return await tx.agent.findMany({
    where: {
      jobs: {
        some: {
          userId,
          organizationId: normalizedOrganizationId,
        },
      },
    },
    include: {
      jobs: {
        where: {
          userId,
          organizationId: normalizedOrganizationId,
        },
        orderBy: {
          startedAt: "desc",
        },
        take: 1,
      },
    },
  });
}

const thresholdDays = getEnvPublicConfig().NEXT_PUBLIC_AGENT_NEW_THRESHOLD_DAYS;

export function mapAgentWithIsNew(
  agent: Omit<AgentWithRelations, "isNew">,
): AgentWithRelations {
  const thresholdMilliseconds = 86_400_000 * thresholdDays;

  return {
    ...agent,
    isNew: agent.createdAt > new Date(Date.now() - thresholdMilliseconds),
  };
}
