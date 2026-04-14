import type { Prisma } from "../generated/prisma/client.js";
import {
  type WorkspaceWithRelations,
  workspaceSummaryInclude,
} from "../types/workspace.js";

export const workspaceRepository = {
  async findPersonalWorkspace(
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

  async findOrganizationWorkspace(
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

  async findWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations | null> {
    if (organizationId) {
      return await this.findOrganizationWorkspace(organizationId, tx);
    } else {
      return await this.findPersonalWorkspace(userId, tx);
    }
  },
};
