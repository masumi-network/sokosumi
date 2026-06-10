import type { Invitation } from "@sokosumi/database";
import {
  invitationRepository,
  memberRepository,
} from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

type ResolvedInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
  organization: { id: string; name: string; slug: string };
  inviter: { id: string; email: string };
};

export type PendingInvitationLookup =
  | { kind: "ok"; invitation: ResolvedInvitation }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "inviter_not_found" };

/**
 * Resolves a pending invitation by id for the accept-invitation flow.
 *
 * The invitation id acts as the capability token (the page is reachable while
 * logged out), so this performs no membership check. Returns a discriminated
 * result so callers can distinguish not-found / expired / orphaned-inviter.
 */
export async function lookupPendingInvitationById(
  id: string,
): Promise<PendingInvitationLookup> {
  const invitation = await invitationRepository.getPendingInvitationById(
    id,
    prisma,
  );

  if (!invitation) {
    return { kind: "not_found" };
  }

  if (invitation.expiresAt < new Date()) {
    return { kind: "expired" };
  }

  const inviterMember =
    await memberRepository.getMemberByUserIdAndOrganizationId(
      invitation.inviterId,
      invitation.organizationId,
      prisma,
    );

  if (!inviterMember) {
    return { kind: "inviter_not_found" };
  }

  return {
    kind: "ok",
    invitation: {
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviterId: invitation.inviterId,
      createdAt: invitation.createdAt,
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
        slug: invitation.organization.slug,
      },
      inviter: {
        id: invitation.inviter.id,
        email: invitation.inviter.email,
      },
    },
  };
}

/**
 * Lists pending invitations for an organization, keeping the most recent
 * invitation per email (the repository orders by expiry descending).
 */
export async function listPendingInvitationsByOrganizationId(
  organizationId: string,
): Promise<Invitation[]> {
  const invitations =
    await invitationRepository.getPendingInvitationsByOrganizationId(
      organizationId,
      prisma,
    );

  const byEmail = new Map<string, Invitation>();
  for (const invitation of invitations) {
    if (!byEmail.has(invitation.email)) {
      byEmail.set(invitation.email, invitation);
    }
  }
  return Array.from(byEmail.values());
}
