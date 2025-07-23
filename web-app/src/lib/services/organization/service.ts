import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import {
  retrieveMemberByUserIdAndOrganizationId,
  retrievePendingInvitationsByOrganizationId,
} from "@/lib/db/repositories";
import { Invitation } from "@/prisma/generated/client";

export async function getOrganizationPendingInvitations(
  organizationId: string,
): Promise<Invitation[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  const myMemberInOrganization = await retrieveMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
  );
  if (
    !myMemberInOrganization ||
    myMemberInOrganization.role !== MemberRole.ADMIN
  ) {
    console.error("You are not the admin of the organization");
    throw new Error("UNAUTHORIZED");
  }

  return await retrievePendingInvitationsByOrganizationId(organizationId);
}
