import type { PrismaClient } from "../generated/prisma/client.js";
import { workspaceRepository } from "../repositories/workspace.repository.js";

export interface OrgOnlyPersonalWorkspaceBackfillDb {
  user: Pick<PrismaClient["user"], "findMany">;
  $transaction: PrismaClient["$transaction"];
}

export interface OrgOnlyPersonalWorkspaceBackfillResult {
  considered: number;
  created: number;
}

/**
 * Temporary overlay (ADR 0010): give every org-only user a personal
 * workspace. Keeps preferredOrganizationId when it is already set. When it is
 * null, sets it to an existing org membership so session create does not
 * drop them into personal.
 *
 * Zero-workspace users (no org membership) are out of scope — they still
 * owe identity onboarding.
 */
export async function backfillPersonalWorkspacesForOrgOnlyUsers(
  prisma: OrgOnlyPersonalWorkspaceBackfillDb,
): Promise<OrgOnlyPersonalWorkspaceBackfillResult> {
  const orgOnlyUsers = await prisma.user.findMany({
    where: {
      members: { some: {} },
      workspace: null,
    },
    select: {
      id: true,
      preferredOrganizationId: true,
      members: {
        select: { organizationId: true },
        take: 1,
        orderBy: { createdAt: "asc" },
      },
    },
  });

  let created = 0;
  for (const user of orgOnlyUsers) {
    const result = await prisma.$transaction(async (tx) => {
      const ensured =
        await workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
          userId: user.id,
          tx,
        });
      const fallbackOrganizationId = user.members[0]?.organizationId;
      if (!user.preferredOrganizationId && fallbackOrganizationId) {
        await tx.user.update({
          where: { id: user.id },
          data: { preferredOrganizationId: fallbackOrganizationId },
        });
      }
      return ensured;
    });
    if (result.created) {
      created += 1;
    }
  }

  return { considered: orgOnlyUsers.length, created };
}
