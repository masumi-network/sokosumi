import { MemberRole, type Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { forbidden, notFound } from "@/helpers/error";

/** Client-like type for read-only org + member lookups (transaction or default client). */
type OrgResolverClient = Pick<
  Prisma.TransactionClient,
  "organization" | "member"
>;

interface ResolveMemberOrganizationInputBase {
  userId: string;
  /** Transaction client or default Prisma client. */
  tx: OrgResolverClient;
  allowedRoles?: MemberRole[];
}

interface ResolveMemberOrganizationByIdInput
  extends ResolveMemberOrganizationInputBase {
  id: string;
}

interface ResolveMemberOrganizationBySlugInput
  extends ResolveMemberOrganizationInputBase {
  slug: string;
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

async function resolveMemberAccess(
  organization: OrganizationRecord,
  input: ResolveMemberOrganizationInputBase,
) {
  if (!organization) {
    throw notFound("Organization not found", {
      kind: CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND,
    });
  }

  const member = await getMemberAccess(input.tx, input.userId, organization.id);
  if (!member) {
    throw forbidden("You are not a member of this organization", {
      kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
    });
  }

  if (
    input.allowedRoles &&
    !input.allowedRoles.includes(member.role as MemberRole)
  ) {
    throw forbidden(`You must be ${input.allowedRoles.join(", ")}`, {
      kind: CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
    });
  }

  return {
    organization,
    role: member.role,
  };
}

export async function resolveMemberOrganizationById(
  input: ResolveMemberOrganizationByIdInput,
) {
  const organization = await getOrganizationById(input.tx, input.id);

  return await resolveMemberAccess(organization, input);
}

export async function resolveMemberOrganizationBySlug(
  input: ResolveMemberOrganizationBySlugInput,
) {
  const organization = await getOrganizationBySlug(input.tx, input.slug);

  return await resolveMemberAccess(organization, input);
}
