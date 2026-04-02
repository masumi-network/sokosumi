import type { Prisma } from "../generated/prisma/client.js";
import {
  type WorkspaceWithRelations,
  workspaceSummaryInclude,
} from "../types/workspace.js";

export const workspaceRepository = {
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

  async upsertWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations> {
    if (organizationId) {
      return await this.upsertOrganizationWorkspace(organizationId, tx);
    } else {
      return await this.upsertPersonalWorkspace(userId, tx);
    }
  },
};
