import { membershipAgeOrderBy } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";
import {
  getOrganizationMetadata,
  hasAdminRole,
  socialProvidersForWorkspace,
} from "@sokosumi/utils";

import { socialProviderWorkspace } from "@/config/social-providers";
import { notFound } from "@/helpers/error";
import { pendingOrganizationInvitationsWhere } from "@/helpers/invitation";
import prisma from "@/lib/db/prisma";
import { isPreprodOn } from "@/lib/network";
import { memberRoleSchema } from "@/schemas/domain-enums.schema";
import type {
  UserWorkspace,
  UserWorkspaces,
} from "@/schemas/user-workspace.schema";
import { pickActiveOrganizationId } from "@/services/preferred-workspace.service";

function preprodAccessForRole(preprodOn: boolean, role: string | undefined) {
  const admin = preprodOn && hasAdminRole(role);
  return (preprodEnabled: boolean | undefined) =>
    preprodOn && (admin || preprodEnabled === true);
}

/** A user API key can be used in any of its owner's workspaces. */
export async function canUserUsePreprod(userId: string): Promise<boolean> {
  const preprodOn = isPreprodOn();
  if (!preprodOn) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      preprodEnabled: true,
      members: {
        where: { organization: { preprodEnabled: true } },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!user) return false;

  const canUsePreprod = preprodAccessForRole(preprodOn, user.role);
  return (
    canUsePreprod(user.preprodEnabled) || canUsePreprod(user.members.length > 0)
  );
}

/**
 * The workspaces a person can act in (personal first, then organizations),
 * which one a new session opens, and their pending organization invitations.
 * An organization membership whose workspace row is missing gets the row, as
 * organization-context requests do, so a member never reads as workspace-less.
 */
export async function listUserWorkspaces(
  userId: string,
): Promise<UserWorkspaces> {
  // While Preprod is off no workspace can use it, so nothing more is read.
  const preprodOn = isPreprodOn();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      preferredOrganizationId: true,
      ...(preprodOn && { role: true, preprodEnabled: true }),
    },
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
              ...(preprodOn && { preprodEnabled: true }),
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

  // The listed person's role, not the caller's: a Coworker listing its
  // context user gets that user's answer.
  const canUsePreprod = preprodAccessForRole(preprodOn, user.role);

  const workspaces: UserWorkspace[] = [];

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
        ...socialProvidersForWorkspace(
          socialProviderWorkspace(null, personalWorkspace.id),
        ),
      ],
      logo: null,
      websiteUrl: null,
      preferred: preferredOrganizationId === null,
      canUsePreprod: canUsePreprod(user.preprodEnabled),
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
        ...socialProvidersForWorkspace(
          socialProviderWorkspace(organization.slug, workspace.id),
        ),
      ],
      logo: organization.logo,
      websiteUrl: getOrganizationMetadata(organization.metadata).url,
      preferred: organization.id === preferredOrganizationId,
      canUsePreprod: canUsePreprod(organization.preprodEnabled),
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
