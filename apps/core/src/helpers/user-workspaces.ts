import { membershipAgeOrderBy } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import { pendingOrganizationInvitationsWhere } from "@/helpers/invitation";
import prisma from "@/lib/db/prisma";
import type {
  UserWorkspace,
  UserWorkspaces,
} from "@/schemas/user-workspace.schema";
import { pickActiveOrganizationId } from "@/services/preferred-organization.service";

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
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              logo: true,
              metadata: true,
              workspace: { select: { id: true } },
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

  if (personalWorkspace) {
    workspaces.push({
      id: personalWorkspace.id,
      kind: "personal",
      name: user.name,
      organizationId: null,
      slug: null,
      logo: null,
      websiteUrl: null,
      preferred: preferredOrganizationId === null,
    });
  }

  for (const { organization } of memberships) {
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
