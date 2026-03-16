import { MemberRole, type Prisma } from "@sokosumi/database";

import { forbidden, notFound } from "@/helpers/error";

interface ResolveMemberOrganizationByIdInput {
  id: string;
  userId: string;
  tx: Prisma.TransactionClient;
  allowedRoles?: MemberRole[];
}

type OrganizationRecord = Awaited<
  ReturnType<Prisma.TransactionClient["organization"]["findUnique"]>
>;
type MemberAccessRecord = Awaited<
  ReturnType<Prisma.TransactionClient["member"]["findUnique"]>
>;

async function getOrganizationById(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<OrganizationRecord> {
  return await tx.organization.findUnique({
    where: { id },
  });
}

async function getMemberAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
): Promise<MemberAccessRecord> {
  return await tx.member.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
  });
}

export async function resolveMemberOrganizationById(
  input: ResolveMemberOrganizationByIdInput,
) {
  const organization = await getOrganizationById(input.tx, input.id);
  if (!organization) {
    throw notFound("Organization not found");
  }

  const member = await getMemberAccess(input.tx, input.userId, organization.id);
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
