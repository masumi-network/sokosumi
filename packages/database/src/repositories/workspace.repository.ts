import type { Prisma } from "../generated/prisma/client.js";
import {
  type WorkspaceWithRelations,
  workspaceSummaryInclude,
} from "../types/workspace.js";

export const workspaceRepository = {
  async getPersonalWorkspace(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations | null> {
    return await tx.workspace.findUnique({
      where: {
        userId,
      },
      include: workspaceSummaryInclude,
    });
  },

  async upsertPersonalWorkspace(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations> {
    return await tx.workspace.upsert({
      where: {
        userId,
      },
      update: {},
      create: {
        user: {
          connect: {
            id: userId,
          },
        },
      },
      include: workspaceSummaryInclude,
    });
  },

  async getOrganizationWorkspace(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations | null> {
    return await tx.workspace.findUnique({
      where: {
        organizationId,
      },
      include: workspaceSummaryInclude,
    });
  },

  async upsertOrganizationWorkspace(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations> {
    return await tx.workspace.upsert({
      where: {
        organizationId,
      },
      update: {},
      create: {
        organization: {
          connect: {
            id: organizationId,
          },
        },
      },
      include: workspaceSummaryInclude,
    });
  },
};
