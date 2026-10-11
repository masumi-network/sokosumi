import { membershipAgeOrderBy } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export interface ActiveOrganizationFacts {
  preferredOrganizationId: string | null;
  hasPersonalWorkspace: boolean;
  /** The person's organizations, oldest membership first. */
  organizationIds: readonly string[];
}

/**
 * The organization a new session opens, or null for the personal workspace:
 * the preferred organization while still a member, then the personal
 * workspace, then the oldest membership.
 */
export function pickActiveOrganizationId({
  preferredOrganizationId,
  hasPersonalWorkspace,
  organizationIds,
}: ActiveOrganizationFacts): string | null {
  if (
    preferredOrganizationId &&
    organizationIds.includes(preferredOrganizationId)
  ) {
    return preferredOrganizationId;
  }
  if (hasPersonalWorkspace) {
    return null;
  }
  return organizationIds[0] ?? null;
}

export async function resolveActiveOrganizationIdForSession(
  userId: string,
): Promise<string | null> {
  const [user, personalWorkspace, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { preferredOrganizationId: true },
    }),
    prisma.workspace.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.member.findMany({
      where: { userId },
      orderBy: [...membershipAgeOrderBy],
      select: { organizationId: true },
    }),
  ]);
  return pickActiveOrganizationId({
    preferredOrganizationId: user?.preferredOrganizationId ?? null,
    hasPersonalWorkspace: personalWorkspace !== null,
    organizationIds: memberships.map((membership) => membership.organizationId),
  });
}

export async function setPreferredOrganizationId(
  userId: string,
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) {
    const personalWorkspace = await prisma.workspace.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!personalWorkspace) {
      throw notFound("Personal workspace is missing", {
        kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
      });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { preferredOrganizationId: null },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      select: { id: true },
    });

    if (!member) {
      throw forbidden("The user is not a member of the organization", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: { preferredOrganizationId: organizationId },
    });
  });
}

export async function setPreferredWorkspace(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true, organizationId: true },
  });

  if (workspace?.organizationId) {
    await setPreferredOrganizationId(userId, workspace.organizationId);
    return;
  }
  if (workspace?.userId === userId) {
    await setPreferredOrganizationId(userId, null);
    return;
  }
  throw notFound("Workspace not found");
}
