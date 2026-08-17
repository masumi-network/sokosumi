import { Prisma, type Workspace } from "../generated/prisma/client.js";

import { vendorGrantRepository } from "./vendor-grant.repository.js";
import { PersonalWorkspaceMissingError } from "./workspace-errors.js";

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function ensureServiceplanGrantForWorkspace(
  workspace: Workspace,
  resolvedByUserId: string | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
    workspaceId: workspace.id,
    resolvedByUserId,
    tx,
  });
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
      await ensureServiceplanGrantForWorkspace(existingWorkspace, null, tx);
      return existingWorkspace;
    }

    try {
      const workspace = await tx.workspace.create({
        data: { organizationId },
      });

      await ensureServiceplanGrantForWorkspace(workspace, null, tx);

      return workspace;
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        const racedWorkspace = await this.findOrganizationWorkspace({
          organizationId,
          tx,
        });
        if (racedWorkspace) {
          await ensureServiceplanGrantForWorkspace(racedWorkspace, null, tx);
          return racedWorkspace;
        }
      }

      throw error;
    }
  },

  /**
   * Resolve the workspace for a user/org context.
   * Organization: find or create. Personal: find or throw
   * {@link PersonalWorkspaceMissingError} — never create.
   */
  async resolveWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<Workspace> {
    if (organizationId) {
      return await this.upsertOrganizationWorkspace({ organizationId, tx });
    }

    const personalWorkspace = await this.findPersonalWorkspace({ userId, tx });
    if (!personalWorkspace) {
      throw new PersonalWorkspaceMissingError();
    }

    await ensureServiceplanGrantForWorkspace(personalWorkspace, userId, tx);
    return personalWorkspace;
  },
};
