import {
  memberRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

export async function resolveActiveOrganizationIdForSession(
  userId: string,
): Promise<string | null> {
  const user = await userRepository.getUserById(userId, prisma);
  const preferredOrganizationId = user?.preferredOrganizationId ?? null;

  if (!preferredOrganizationId) {
    return null;
  }

  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    userId,
    preferredOrganizationId,
    prisma,
  );

  return member ? preferredOrganizationId : null;
}
