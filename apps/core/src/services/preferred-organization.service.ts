import {
  memberRepository,
  userRepository,
  workspaceRepository,
} from "@sokosumi/database/repositories";

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
