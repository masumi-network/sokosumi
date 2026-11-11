import * as Sentry from "@sentry/node";
import type { Workspace } from "@sokosumi/database";
import {
  getCreditExpiryDate,
  grantSignupBonusCredits,
} from "@sokosumi/database/helpers";
import {
  vendorGrantRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { conflict, notFound } from "@/helpers/error";
import {
  isPrismaForeignKeyViolation,
  isPrismaUniqueViolation,
} from "@/helpers/prisma";
import { isLastWorkspace } from "@/helpers/workspace-access";
import prisma from "@/lib/db/prisma";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

// Best effort: a failed grant must not undo the workspace. Idempotent per
// user, so deleting and recreating the workspace grants nothing new.
async function grantSignupBonus(userId: string): Promise<void> {
  const { SIGNUP_BONUS_CREDITS, SIGNUP_BONUS_TTL_DAYS } = getEnv();
  const grantedAt = new Date();
  const expiresAt = getCreditExpiryDate(grantedAt, SIGNUP_BONUS_TTL_DAYS);

  try {
    await prisma.$transaction(async (tx) => {
      const { created } = await grantSignupBonusCredits(
        {
          credits: SIGNUP_BONUS_CREDITS,
          expiresAt,
          userId,
        },
        tx,
      );

      if (created) {
        await markOutOfCreditsTasksAsToppedUp({
          organizationId: null,
          tx,
          userId,
        });
      }
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "signup_bonus_grant",
      },
      extra: {
        userId,
      },
    });
  }
}

/**
 * Creates the user's one personal workspace and makes it preferred by
 * clearing preferredOrganizationId. Conflicts when one already exists.
 * Grants the signup bonus, which lives in the personal workspace.
 */
export async function createPersonalWorkspace(
  userId: string,
): Promise<Workspace> {
  const workspace = await prisma.$transaction(async (tx) => {
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

    // The same seed the repository's creation path uses. A workspace
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

  await grantSignupBonus(userId);

  return workspace;
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
