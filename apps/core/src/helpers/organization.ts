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

async function getOrganizationBySlug(
  tx: OrgResolverClient,
  slug: string,
): Promise<OrganizationRecord> {
  return await tx.organization.findUnique({
    where: { slug },
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

async function resolveMemberOrganizationRecord(
  input: ResolveMemberOrganizationByIdInput & {
    organization: NonNullable<OrganizationRecord>;
  },
) {
  const member = await getMemberAccess(
    input.tx,
    input.userId,
    input.organization.id,
  );
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
    organization: input.organization,
    role: member.role,
  };
}

export async function resolveMemberOrganizationById(
  input: ResolveMemberOrganizationByIdInput,
) {
  const organization = await getOrganizationById(input.tx, input.id);
  if (!organization) {
    throw notFound("Organization not found");
  }

  return resolveMemberOrganizationRecord({
    ...input,
    organization,
  });
}

interface ResolveMemberOrganizationBySlugInput {
  slug: string;
  userId: string;
  tx: OrgResolverClient;
  allowedRoles?: MemberRole[];
}

export async function resolveMemberOrganizationBySlug(
  input: ResolveMemberOrganizationBySlugInput,
) {
  const organization = await getOrganizationBySlug(input.tx, input.slug);
  if (!organization) {
    throw notFound("Organization not found");
  }

  return resolveMemberOrganizationRecord({
    id: organization.id,
    userId: input.userId,
    tx: input.tx,
    allowedRoles: input.allowedRoles,
    organization,
  });
}
