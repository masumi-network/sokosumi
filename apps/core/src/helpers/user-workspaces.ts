import { workspaceRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { pendingOrganizationInvitationsWhere } from "@/helpers/workspace-access";
import prisma from "@/lib/db/prisma";
import type {
  UserWorkspace,
  UserWorkspaces,
} from "@/schemas/user-workspace.schema";
import { resolveActiveOrganizationIdForSession } from "@/services/preferred-organization.service";

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
    select: { name: true, email: true },
  });
  if (!user) {
    throw notFound("User not found");
  }

  const [
    personalWorkspace,
    memberships,
    pendingInvitationCount,
    preferredOrganizationId,
  ] = await Promise.all([
    prisma.workspace.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.member.findMany({
      where: { userId },
      select: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            workspace: { select: { id: true } },
          },
        },
      },
    }),
    prisma.invitation.count({
      where: pendingOrganizationInvitationsWhere(user.email),
    }),
    resolveActiveOrganizationIdForSession(userId),
  ]);

  const workspaces: UserWorkspace[] = [];

  if (personalWorkspace) {
    workspaces.push({
      id: personalWorkspace.id,
      kind: "personal",
      name: user.name,
      organizationId: null,
      slug: null,
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
      preferred: organization.id === preferredOrganizationId,
    });
  }

  return { workspaces, pendingInvitationCount };
}

/**
 * One of the person's workspaces, by workspace id or organization id, as
 * {@link listUserWorkspaces} lists it.
 */
export async function getUserWorkspace(
  userId: string,
  key: { id: string } | { organizationId: string },
): Promise<UserWorkspace> {
  const { workspaces } = await listUserWorkspaces(userId);
  const workspace = workspaces.find((candidate) =>
    "id" in key
      ? candidate.id === key.id
      : candidate.organizationId === key.organizationId,
  );
  if (!workspace) {
    throw notFound("Workspace not found");
  }
  return workspace;
}
