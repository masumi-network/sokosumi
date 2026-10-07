import {
  memberRepository,
  userRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
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
  const [user, personalWorkspace, organizationIds] = await Promise.all([
    userRepository.getUserById(userId, prisma),
    workspaceRepository.findPersonalWorkspace({ userId, tx: prisma }),
    memberRepository.getMembersOrganizationIdsByUserId(userId, prisma),
  ]);
  return pickActiveOrganizationId({
    preferredOrganizationId: user?.preferredOrganizationId ?? null,
    hasPersonalWorkspace: personalWorkspace !== null,
    organizationIds,
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
    await userRepository.updatePreferredOrganizationId(userId, null, prisma);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      organizationId,
      tx,
    );

    if (!member) {
      throw forbidden("The user is not a member of the organization", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
      });
    }

    await userRepository.updatePreferredOrganizationId(
      userId,
      organizationId,
      tx,
    );
  });
}
