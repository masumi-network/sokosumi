import type { Workspace } from "@sokosumi/database";
import {
  vendorGrantRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";

import { conflict } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
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
