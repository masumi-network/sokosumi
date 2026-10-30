import { membershipAgeOrderBy } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";
import {
  getOrganizationMetadata,
  socialProvidersForWorkspace,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { pendingOrganizationInvitationsWhere } from "@/helpers/invitation";
import prisma from "@/lib/db/prisma";
import { memberRoleSchema } from "@/schemas/domain-enums.schema";
import type {
  UserWorkspace,
  UserWorkspaces,
} from "@/schemas/user-workspace.schema";
import { pickActiveOrganizationId } from "@/services/preferred-workspace.service";

/**
 * The workspaces a person can act in (personal first, then organizations),
 * which one a new session opens, and their pending organization invitations.
 * An organization membership whose workspace row is missing gets the row, as
 * organization-context requests do, so a member never reads as workspace-less.
 */
export async function listUserWorkspaces(
  userId: string,
): Promise<UserWorkspaces> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, preferredOrganizationId: true },
  });
  if (!user) {
    throw notFound("User not found");
  }

  const [personalWorkspace, memberships, pendingInvitationCount] =
    await Promise.all([
      prisma.workspace.findUnique({
        where: { userId },
        select: { id: true },
      }),
      prisma.member.findMany({
        where: { userId },
        orderBy: [...membershipAgeOrderBy],
        select: {
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              logo: true,
              metadata: true,
              workspace: { select: { id: true } },
              _count: { select: { members: true } },
            },
          },
        },
      }),
      prisma.invitation.count({
        where: pendingOrganizationInvitationsWhere(user.email),
      }),
    ]);
  // The rule a new session opens with, over the rows already loaded.
  const preferredOrganizationId = pickActiveOrganizationId({
    preferredOrganizationId: user.preferredOrganizationId,
    hasPersonalWorkspace: personalWorkspace !== null,
    organizationIds: memberships.map(({ organization }) => organization.id),
  });

  const workspaces: UserWorkspace[] = [];
  const linkedInCompanyPagesEnabled =
    getEnv().SOCIAL_LINKEDIN_COMPANY_PAGES_ENABLED;

  if (personalWorkspace) {
    workspaces.push({
      id: personalWorkspace.id,
      kind: "personal",
      name: user.name,
      organizationId: null,
      slug: null,
      role: null,
      memberCount: null,
      enabledSocialProviders: [
        ...socialProvidersForWorkspace({ organizationSlug: null }),
      ],
      linkedInCompanyPagesEnabled,
      logo: null,
      websiteUrl: null,
      preferred: preferredOrganizationId === null,
    });
  }

  for (const { role, organization } of memberships) {
    const workspace =
      organization.workspace ??
      (await workspaceRepository.upsertOrganizationWorkspace({
        organizationId: organization.id,
        tx: prisma,
      }));
    workspaces.push({
      id: workspace.id,
      kind: "organization",
      name: organization.name,
      organizationId: organization.id,
      slug: organization.slug,
      // An unknown stored role reads as no role, so one bad row cannot fail the list.
      role: memberRoleSchema.safeParse(role).data ?? null,
      memberCount: organization._count.members,
      enabledSocialProviders: [
        ...socialProvidersForWorkspace({ organizationSlug: organization.slug }),
      ],
      linkedInCompanyPagesEnabled,
      logo: organization.logo,
      websiteUrl: getOrganizationMetadata(organization.metadata).url,
      preferred: organization.id === preferredOrganizationId,
    });
  }

  return { workspaces, pendingInvitationCount };
}

/** Finds a listed workspace by workspace id or by organization id. */
export type UserWorkspaceMatch = { id: string } | { organizationId: string };

/** One of the person's workspaces, as {@link listUserWorkspaces} lists it. */
export async function getUserWorkspace(
  userId: string,
  match: UserWorkspaceMatch,
): Promise<UserWorkspace> {
  const { workspaces } = await listUserWorkspaces(userId);
  const workspace = workspaces.find((candidate) =>
    "id" in match
      ? candidate.id === match.id
      : candidate.organizationId === match.organizationId,
  );
  if (!workspace) {
    throw notFound("Workspace not found");
  }
  return workspace;
}
