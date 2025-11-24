import prisma from "../client";
import type { AgentList, AgentListType } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { agentListInclude, type AgentListWithAgents } from "../types/agentList";

/**
 * Type guard to check if an error is a Prisma unique constraint violation.
 */
function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError & {
  code: "P2002";
  meta?: { target?: unknown[] };
} {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  // TypeScript now knows error is PrismaClientKnownRequestError
  const prismaError = error as Prisma.PrismaClientKnownRequestError;
  return prismaError.code === "P2002";
}

/**
 * Repository for managing agent lists associated with users.
 *
 * Provides methods to create, retrieve, add agents to, and remove agents from user-specific agent lists.
 */
export const agentListRepository = {
  /**
   * Upserts a new agent list for a user of a specific type.
   * Handles race conditions by catching unique constraint violations and fetching the existing record.
   *
   * @param userId - The ID of the user.
   * @param type - The type of the agent list (e.g., FAVORITE).
   * @param tx - Optional Prisma transaction client.
   * @returns The created or existing agent list with included agents.
   */
  async upsertAgentListForUserId(
    userId: string,
    type: AgentListType,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentListWithAgents> {
    try {
      return await tx.agentList.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type },
        update: {},
        include: agentListInclude,
      });
    } catch (error: unknown) {
      // Handle race condition: if another transaction created the record,
      // catch the unique constraint violation and fetch the existing record
      // See: https://www.prisma.io/docs/orm/reference/prisma-client-reference#unique-key-constraint-errors-on-upserts
      if (isPrismaUniqueConstraintError(error)) {
        // Verify this is the constraint we expect (userId, type)
        const existingList = await this.getAgentListByUserId(userId, type, tx);
        if (existingList) {
          return existingList;
        }
      }
      // Re-throw any other errors
      throw error;
    }
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
