import type { Prisma } from "../generated/prisma/client.js";
import {
  type WorkspaceWithRelations,
  workspaceSummaryInclude,
} from "../types/workspace.js";
import { memberRepository } from "./member.repository.js";

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

  async findWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations | null> {
    if (organizationId) {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        tx,
      );
      if (!member) {
        return null;
      }
      return await this.findOrganizationWorkspace(organizationId, tx);
    }
    return await this.findPersonalWorkspace(userId, tx);
  },

  async upsertWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<WorkspaceWithRelations> {
    if (organizationId) {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        tx,
      );
      if (!member) {
        return await this.upsertPersonalWorkspace(userId, tx);
      }
      return await this.upsertOrganizationWorkspace(organizationId, tx);
    }
    return await this.upsertPersonalWorkspace(userId, tx);
  },
};
