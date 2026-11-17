import { MemberRole } from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/**
 * Owners and admins may feature a Project for their whole organization. A
 * personal workspace has no organization, so nothing in it can be featured.
 */
export async function canFeatureProjects(
  userId: string,
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) return false;
  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  return member?.role === MemberRole.OWNER || member?.role === MemberRole.ADMIN;
}

export async function requireCanFeatureProjects(
  userId: string,
  organizationId: string | null,
): Promise<void> {
  if (!(await canFeatureProjects(userId, organizationId))) {
    throw forbidden("Only owners and admins can feature a Project");
  }
}
