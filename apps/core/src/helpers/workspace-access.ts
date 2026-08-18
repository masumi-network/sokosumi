import type { Prisma } from "@sokosumi/database";
import { InvitationStatus } from "@sokosumi/database";

import { normalizeInvitationEmail } from "@/helpers/chat-room-invitation";

export const WORKSPACE_GATE_STATUSES = [
  "ready",
  "pending-invites",
  "identity-onboarding",
] as const;

export type WorkspaceGateStatus = (typeof WORKSPACE_GATE_STATUSES)[number];

export interface WorkspaceAccessFacts {
  hasPersonalWorkspace: boolean;
  hasOrganizationMembership: boolean;
  hasPendingOrganizationInvites: boolean;
}

export interface WorkspaceAccess extends WorkspaceAccessFacts {
  gate: WorkspaceGateStatus;
}

export type LastWorkspaceRemoval =
  | { type: "personal" }
  | { type: "organization"; organizationId: string };

/**
 * True when removing this workspace would leave the user with zero workspaces.
 * Personal delete needs any remaining org membership. Organization delete
 * needs a personal workspace or another org membership.
 *
 * Org membership is enough: organization create upserts the workspace row.
 * Do not require that row here or last-workspace can disagree with create.
 */
export async function isLastWorkspace(
  userId: string,
  removing: LastWorkspaceRemoval,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  if (removing.type === "personal") {
    const membership = await tx.member.findFirst({
      where: { userId },
      select: { id: true },
    });
    return membership == null;
  }

  const personalWorkspace = await tx.workspace.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (personalWorkspace) {
    return false;
  }

  const otherMembership = await tx.member.findFirst({
    where: {
      userId,
      organizationId: { not: removing.organizationId },
    },
    select: { id: true },
  });

  return otherMembership == null;
}

/**
 * Single resolver for the workspace gate. Personal workspace and/or any
 * organization membership is `ready` (pending invites ignored). Otherwise
 * pending org invitations yield `pending-invites`; else identity onboarding.
 */
export function deriveWorkspaceGate(
  facts: WorkspaceAccessFacts,
): WorkspaceGateStatus {
  if (facts.hasPersonalWorkspace || facts.hasOrganizationMembership) {
    return "ready";
  }
  if (facts.hasPendingOrganizationInvites) {
    return "pending-invites";
  }
  return "identity-onboarding";
}

/**
 * Loads access facts for a user and derives the workspace gate.
 * Pending invites: non-expired PENDING organization invitations for the user's
 * email (trim + lowercase). Join-link mid-flow is not counted here.
 */
export async function loadWorkspaceAccess(
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<WorkspaceAccess> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return {
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
      gate: "identity-onboarding",
    };
  }

  const email = normalizeInvitationEmail(user.email);

  const [personalWorkspace, membership, pendingInvite] = await Promise.all([
    tx.workspace.findUnique({
      where: { userId },
      select: { id: true },
    }),
    tx.member.findFirst({
      where: { userId },
      select: { id: true },
    }),
    tx.invitation.findFirst({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true },
    }),
  ]);

  const facts: WorkspaceAccessFacts = {
    hasPersonalWorkspace: personalWorkspace != null,
    hasOrganizationMembership: membership != null,
    hasPendingOrganizationInvites: pendingInvite != null,
  };

  return {
    ...facts,
    gate: deriveWorkspaceGate(facts),
  };
}
