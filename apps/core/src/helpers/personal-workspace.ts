import type { Workspace } from "@sokosumi/database";
import {
  vendorGrantRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { conflict, notFound } from "@/helpers/error";
import {
  isPrismaForeignKeyViolation,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import { isLastWorkspace } from "@/helpers/workspace-access";
import prisma from "@/lib/db/prisma";

/**
 * Creates the user's one personal workspace and makes it preferred by
 * clearing preferredOrganizationId. Conflicts when one already exists.
 */
export async function createPersonalWorkspace(
  userId: string,
): Promise<Workspace> {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findUnique({
      where: { userId },
    });

    if (existing) {
      throw conflict("Personal workspace already exists");
    }

    let createdWorkspace: Workspace;
    try {
      createdWorkspace = await tx.workspace.create({
        data: { userId },
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw conflict("Personal workspace already exists");
      }
      throw error;
    }

    await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
      workspaceId: createdWorkspace.id,
      resolvedByUserId: userId,
      tx,
    });

    // The same seed the repository's two creation paths use. A workspace
    // with no Files vocabulary produces no tags at all, silently, and this
    // is the one creation path that does not go through
    // `workspaceRepository`.
    await workspaceRepository.seedCuratedVocabulary(createdWorkspace.id, tx);

    await tx.user.update({
      where: { id: userId },
      data: { preferredOrganizationId: null },
    });

    return createdWorkspace;
  });
}

/**
 * Deletes the user's personal workspace. Refused when it is missing (404),
 * when it is their last workspace, or while jobs or tasks still use it (409).
 * Without a preferred organization, a remaining membership becomes preferred
 * first, so the next session opens a workspace that still exists.
 */
export async function deletePersonalWorkspace(
  userId: string,
): Promise<Workspace> {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.workspace.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw notFound("Personal workspace is missing", {
        kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
      });
    }

    if (await isLastWorkspace(userId, { type: "personal" }, tx)) {
      throw conflict("Cannot delete the user's last workspace", {
        kind: CORE_API_ERROR_KINDS.LAST_WORKSPACE,
      });
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { preferredOrganizationId: true },
    });
    if (user?.preferredOrganizationId == null) {
      const remainingMembership = await tx.member.findFirst({
        where: { userId },
        select: { organizationId: true },
      });
      if (remainingMembership) {
        await tx.user.update({
          where: { id: userId },
          data: {
            preferredOrganizationId: remainingMembership.organizationId,
          },
        });
      }
    }

    try {
      await tx.workspace.delete({
        where: { id: existing.id },
      });
    } catch (error) {
      if (isPrismaForeignKeyViolation(error)) {
        throw conflict(
          "Cannot delete a personal workspace that still has jobs or tasks",
          {
            kind: CORE_API_ERROR_KINDS.WORKSPACE_HAS_DEPENDENTS,
          },
        );
      }
      throw error;
    }

    return existing;
  });
}
