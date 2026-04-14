import { Prisma, type Workspace } from "../generated/prisma/client.js";

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export const workspaceRepository = {
  async findPersonalWorkspace({
    userId,
    tx,
  }: {
    userId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Workspace | null> {
    return await tx.workspace.findUnique({
      where: { userId },
    });
  },

  async upsertPersonalWorkspace({
    userId,
    tx,
  }: {
    userId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Workspace> {
    const existingWorkspace = await this.findPersonalWorkspace({ userId, tx });
    if (existingWorkspace) {
      return existingWorkspace;
    }

    try {
      return await tx.workspace.create({
        data: { userId },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        const racedWorkspace = await this.findPersonalWorkspace({ userId, tx });
        if (racedWorkspace) {
          return racedWorkspace;
        }
      }

      throw error;
    }
  },

  async findOrganizationWorkspace({
    organizationId,
    tx,
  }: {
    organizationId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Workspace | null> {
    return await tx.workspace.findUnique({
      where: { organizationId },
    });
  },

  async upsertOrganizationWorkspace({
    organizationId,
    tx,
  }: {
    organizationId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Workspace> {
    const existingWorkspace = await this.findOrganizationWorkspace({
      organizationId,
      tx,
    });
    if (existingWorkspace) {
      return existingWorkspace;
    }

    try {
      return await tx.workspace.create({
        data: { organizationId },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        const racedWorkspace = await this.findOrganizationWorkspace({
          organizationId,
          tx,
        });
        if (racedWorkspace) {
          return racedWorkspace;
        }
      }

      throw error;
    }
  },

  async upsertWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<Workspace> {
    if (organizationId) {
      return await this.upsertOrganizationWorkspace({ organizationId, tx });
    } else {
      return await this.upsertPersonalWorkspace({ userId, tx });
    }
  },
};
