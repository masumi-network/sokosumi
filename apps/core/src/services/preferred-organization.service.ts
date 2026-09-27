import {
  memberRepository,
  userRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export async function resolveActiveOrganizationIdForSession(
  userId: string,
): Promise<string | null> {
  const user = await userRepository.getUserById(userId, prisma);
  const preferredOrganizationId = user?.preferredOrganizationId ?? null;

  if (preferredOrganizationId) {
    const member = await memberRepository.getMemberByUserIdAndOrganizationId(
      userId,
      preferredOrganizationId,
      prisma,
    );
    if (member) {
      return preferredOrganizationId;
    }
  }

  const personalWorkspace = await workspaceRepository.findPersonalWorkspace({
    userId,
    tx: prisma,
  });
  if (personalWorkspace) {
    return null;
  }

  const organizationIds =
    await memberRepository.getMembersOrganizationIdsByUserId(userId, prisma);
  return organizationIds[0] ?? null;
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
