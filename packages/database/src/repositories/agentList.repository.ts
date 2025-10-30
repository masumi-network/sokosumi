import "server-only";

import prisma from "../client";
import type {
  AgentList,
  AgentListType,
  Prisma,
} from "../generated/prisma/client";
import { agentListInclude, type AgentListWithAgents } from "../types/agentList";

/**
 * Repository for managing agent lists associated with users.
 *
 * Provides methods to create, retrieve, add agents to, and remove agents from user-specific agent lists.
 */
export const agentListRepository = {
  /**
   * Upserts a new agent list for a user of a specific type.
   *
   * @param userId - The ID of the user.
   * @param type - The type of the agent list (e.g., FAVORITE).
   * @param tx - Optional Prisma transaction client.
   * @returns The created agent list with included agents.
   */
  async upsertAgentListForUserId(
    userId: string,
    type: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentListWithAgents> {
    return await tx.agentList.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type },
      update: {},
      include: agentListInclude,
    });
  },

  /**
   * Retrieves an agent list for a user by type.
   *
   * @param userId - The ID of the user.
   * @param type - The type of the agent list.
   * @param tx - Optional Prisma transaction client.
   * @returns The agent list with included agents, or null if not found.
   */
  async getAgentListByUserId(
    userId: string,
    type: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentListWithAgents | null> {
    return await tx.agentList.findUnique({
      where: {
        userId_type: {
          userId,
          type,
        },
      },
      include: agentListInclude,
    });
  },

  /**
   * Removes an agent from a user's agent list of a specific type.
   *
   * @param agentId - The ID of the agent to remove.
   * @param userId - The ID of the user.
   * @param listType - The type of the agent list.
   * @param tx - Optional Prisma transaction client.
   * @returns The updated agent list.
   */
  async removeAgentFromAgentList(
    agentId: string,
    userId: string,
    listType: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentList> {
    return await tx.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { disconnect: { id: agentId } },
      },
    });
  },

  /**
   * Adds an agent to a user's agent list of a specific type.
   *
   * @param agentId - The ID of the agent to add.
   * @param userId - The ID of the user.
   * @param listType - The type of the agent list.
   * @param tx - Optional Prisma transaction client.
   * @returns The updated agent list.
   */
  async addAgentToAgentList(
    agentId: string,
    userId: string,
    listType: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentList> {
    return await tx.agentList.update({
      where: { userId_type: { userId, type: listType } },
      data: {
        agents: { connect: { id: agentId } },
      },
    });
  },
};
