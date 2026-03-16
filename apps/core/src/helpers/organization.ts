import { MemberRole, type Prisma } from "@sokosumi/database";

import { forbidden, notFound } from "@/helpers/error";

interface ResolveMemberOrganizationByIdOrSlugInput {
  idOrSlug: string;
  userId: string;
  tx: Prisma.TransactionClient;
  allowedRoles?: MemberRole[];
}

export async function resolveMemberOrganizationByIdOrSlug(
  input: ResolveMemberOrganizationByIdOrSlugInput,
) {
  let organization = await input.tx.organization.findUnique({
    where: { id: input.idOrSlug },
  });

  if (!organization) {
    organization = await input.tx.organization.findUnique({
      where: { slug: input.idOrSlug },
    });
  }

  if (!organization) {
    throw notFound("Organization not found");
  }

  const member = await input.tx.member.findUnique({
    where: {
      userId_organizationId: {
        userId: input.userId,
        organizationId: organization.id,
      },
    },
    select: { role: true },
  });

  if (!member) {
    throw forbidden("You are not a member of this organization");
  }

  if (
    input.allowedRoles &&
    !input.allowedRoles.includes(member.role as MemberRole)
  ) {
    throw forbidden("You must be an organization admin or owner");
  }

  return {
    organization,
    role: member.role,
  };
}
