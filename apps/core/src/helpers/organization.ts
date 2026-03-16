import { MemberRole, type Prisma } from "@sokosumi/database";

import { forbidden, notFound } from "@/helpers/error";

/** Client-like type for read-only org + member lookups (transaction or default client). */
type OrgResolverClient = Pick<
  Prisma.TransactionClient,
  "organization" | "member"
>;

interface ResolveMemberOrganizationByIdInput {
  id: string;
  userId: string;
  /** Transaction client or default Prisma client. */
  tx: OrgResolverClient;
  allowedRoles?: MemberRole[];
}

type OrganizationRecord = Awaited<
  ReturnType<OrgResolverClient["organization"]["findUnique"]>
>;
type MemberAccessRecord = Awaited<
  ReturnType<OrgResolverClient["member"]["findUnique"]>
>;

async function getOrganizationById(
  tx: OrgResolverClient,
  id: string,
): Promise<OrganizationRecord> {
  return await tx.organization.findUnique({
    where: { id },
  });
}

async function getMemberAccess(
  tx: OrgResolverClient,
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
    throw forbidden(`You must be ${input.allowedRoles.join(", ")}`);
  }

  return {
    organization,
    role: member.role,
  };
}
