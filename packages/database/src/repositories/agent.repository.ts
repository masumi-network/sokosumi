import type { Agent, AgentStatus, Prisma } from "../generated/prisma/client.js";
import {
  type AgentWithJobs,
  type AgentWithPricing,
  type AgentWithRelations,
  agentInclude,
  agentOrderBy,
  agentPricingInclude,
} from "../types/agent.js";

/**
 * Repository for managing Agent entities and related queries.
 * Provides methods for retrieving agents with various relation inclusions,
 * filtering by status and visibility.
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
    tx: Prisma.TransactionClient,
  ): Promise<AgentWithRelations | null> {
    return await tx.agent.findUnique({
      where: { id },
      include: agentInclude,
    });
  },

  /**
   * Fetch a single agent by ID with only fixed pricing information.
   * Optimized for pricing-only queries.
   *
   * @param id - Agent unique identifier
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Agent with pricing data, or null if not found
   */
  async getAgentWithPricingById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<AgentWithPricing | null> {
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
    tx: Prisma.TransactionClient,
  ): Promise<AgentWithRelations | null> {
    return await tx.agent.findUnique({
      where: { id: agentId, isShown: true, status },
      include: agentInclude,
    });
  },

  /**
   * Fetch all agents with all related entities.
   *
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Array of agents with relations
   */
  async getAgentsWithRelations(
    tx: Prisma.TransactionClient,
  ): Promise<AgentWithRelations[]> {
    return await tx.agent.findMany({
      include: agentInclude,
    });
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
    tx: Prisma.TransactionClient,
  ): Promise<AgentWithRelations[]> {
    return await tx.agent.findMany({
      include: agentInclude,
      orderBy: [...agentOrderBy],
      where: {
        status,
        isShown: true,
      },
    });
  },

  /**
   * Fetch all agents that have jobs for a specific user and workspace placement.
   * Each agent includes only the latest job for that user/workspace (ordered by createdAt desc).
   *
   * @param userId - User unique identifier
   * @param workspaceId - Workspace unique identifier
   * @param tx - Optional Prisma transaction client (defaults to main Prisma client)
   * @returns Array of agents with their latest job for the user/workspace
   */
  async getHiredAgentsWithLatestJobByUserIdAndWorkspace(
    userId: string,
    workspaceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<AgentWithJobs[]> {
    const jobWhereCondition = {
      ownerId: userId,
      workspaceId,
    };

    return await tx.agent.findMany({
      where: {
        jobs: {
          some: jobWhereCondition,
        },
      },
      include: {
        jobs: {
          where: jobWhereCondition,
          orderBy: { createdAt: "desc" },
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
    tx: Prisma.TransactionClient,
  ): Promise<
    Prisma.AgentGetPayload<{
      include: { metadataOverride: true };
    }>[]
  > {
    return await tx.agent.findMany({
      where: {
        status: "ONLINE",
        isShown: true,
        summary: null,
        OR: [
          { description: { not: null } },
          { metadataOverride: { description: { not: null } } },
        ],
      },
      include: {
        metadataOverride: true,
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
    tx: Prisma.TransactionClient,
  ): Promise<Agent> {
    return await tx.agent.update({
      where: { id },
      data: { summary },
    });
  },
};
