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
import { Agent, AgentStatus, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Repository for managing Agent entities and related queries.
 * Provides methods for retrieving agents with various relation inclusions,
 * filtering by status and visibility, and mapping computed properties.
 */
export const agentRepository = {
  /**
   * Fetch a single agent by ID with all related entities (pricing, tags, outputs, ratings, etc).
   *
   * @param id - Agent unique identifier
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Agent with all relations, or null if not found
   */
  async getAgentWithRelationsById(
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
  },

  /**
   * Fetch a single agent by ID with only organization-related data.
   * Optimized for access control scenarios.
   *
   * @param id - Agent unique identifier
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Agent with organization data, or null if not found
   */
  async getAgentWithOrganizationsById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentWithOrganizations | null> {
    return await tx.agent.findUnique({
      where: { id },
      include: agentOrganizationsInclude,
    });
  },

  /**
   * Fetch a single agent by ID with only fixed pricing information.
   * Optimized for pricing-only queries.
   *
   * @param id - Agent unique identifier
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Agent with fixed pricing data, or null if not found
   */
  async getAgentWithFixedPricingById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentWithFixedPricing | null> {
    return await tx.agent.findUnique({
      where: { id },
      include: agentPricingInclude,
    });
  },

  /**
   * Fetch a single agent by ID, only if it is shown and matches the given status.
   * Includes all related entities.
   *
   * @param agentId - Agent unique identifier
   * @param status - Required agent status
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Agent with relations, or null if not found
   */
  async getShownAgentWithRelationById(
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
  },

  /**
   * Fetch all agents with all related entities.
   *
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Array of agents with relations
   */
  async getAgentsWithRelations(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentWithRelations[]> {
    const agents = await tx.agent.findMany({
      include: agentInclude,
    });

    return agents.map(mapAgentWithIsNew);
  },

  /**
   * Fetch all agents that are marked as shown and have a specific status.
   * Results are sorted by jobs count (descending) and include all related entities.
   *
   * @param status - Required agent status
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Array of shown agents with relations
   */
  async getShownAgentsWithRelationsByStatus(
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
  },

  /**
   * Fetch all agents that have jobs for a specific user and organization context.
   * Each agent includes only the latest job for that user/org.
   *
   * @param userId - User unique identifier
   * @param organizationId - Organization unique identifier (null for personal jobs)
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Array of agents with their latest job for the user/org
   */
  async getHiredAgentsWithJobsByUserIdAndOrganization(
    userId: string,
    organizationId: string | null | undefined,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentWithJobs[]> {
    const normalizedOrganizationId = organizationId ?? null;

    // Build the where condition based on whether user has an organization
    const jobWhereCondition = normalizedOrganizationId
      ? {
          OR: [
            // User's own jobs
            { userId },
            // Jobs shared with user's organization
            {
              shares: {
                some: {
                  recipientOrganizationId: normalizedOrganizationId,
                },
              },
            },
          ],
        }
      : { userId }; // If no organization, only show user's own jobs

    return await tx.agent.findMany({
      where: {
        jobs: {
          some: jobWhereCondition,
        },
      },
      include: {
        jobs: {
          where: jobWhereCondition,
          orderBy: {
            startedAt: "desc",
          },
          take: 1,
        },
      },
    });
  },

  /**
   * Get available agents without a summary but have description to make a summary.
   *
   * @param limit - Maximum number of agents to return
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Array of agents without a summary
   */
  async getAvailableAgentsWithoutSummary(
    limit: number | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Agent[]> {
    return await tx.agent.findMany({
      where: {
        status: AgentStatus.ONLINE,
        isShown: true,
        summary: null,
        OR: [
          { description: { not: null } },
          { overrideDescription: { not: null } },
        ],
      },
      take: limit ?? undefined,
    });
  },

  /**
   * Update the summary of an agent.
   *
   * @param id - Agent unique identifier
   * @param summary - New summary
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Updated agent
   */
  async updateAgentSummary(
    id: string,
    summary: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Agent> {
    return await tx.agent.update({
      where: { id },
      data: { summary },
    });
  },
};

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
