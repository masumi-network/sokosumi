import "server-only";

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
 * Retrieve an agent by ID with all related data
 *
 * This function fetches a single agent from the database including all its
 * related entities such as pricing, tags, example outputs, ratings, etc.
 *
 * @param id - The unique identifier of the agent to retrieve
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to the agent with relations, or null if not found
 */
export async function retrieveAgentWithRelationsById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations | null> {
  return await tx.agent.findUnique({
    where: { id },
    include: agentInclude,
  });
}

/**
 * Retrieve an agent by ID with organization information
 *
 * This function fetches a single agent from the database including only
 * its organization-related data. This is optimized for scenarios where only
 * organization access control information is needed, such as checking if a
 * user has permission to access an agent based on their organization membership.
 *
 * @param id - The unique identifier of the agent to retrieve
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to the agent with organization data, or null if not found
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
 * Retrieve an agent by ID with fixed pricing information
 *
 * This function fetches a single agent from the database including only
 * its pricing-related data. This is optimized for scenarios where only
 * pricing information is needed, avoiding the overhead of fetching all
 * related entities.
 *
 * @param id - The unique identifier of the agent to retrieve
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to the agent with fixed pricing data, or null if not found
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
 * Retrieve all shown agents with relations by status
 *
 * This function fetches all agents from the database that are marked as shown
 * and have a specific status. It returns an array of agents with their related
 * entities such as pricing, tags, example outputs, ratings, etc.
 * And sort by jobs count in descending order.
 *
 * @param status - The status of the agents to retrieve
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns A Promise that resolves to an array of agents with relations
 */
export async function retrieveShownAgentsWithRelationsByStatus(
  status: AgentStatus,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentWithRelations[]> {
  return await tx.agent.findMany({
    include: agentInclude,
    orderBy: [...agentOrderBy],
    where: {
      status,
      isShown: true,
    },
  });
}

/**
 * Retrieves agents that have jobs for a specific user and organization context
 * @param userId - The unique identifier of the user
 * @param organizationId - The unique identifier of the organization (null for personal jobs)
 * @returns Promise containing an array of agents with their latest job
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
