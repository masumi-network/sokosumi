import type { Prisma } from "@sokosumi/database";
import { InvitationStatus } from "@sokosumi/database";

import { normalizeInvitationEmail } from "@/helpers/chat-room-invitation";

export const WORKSPACE_GATE_STATUSES = [
  "ready",
  "pending-invites",
  "identity-onboarding",
] as const;

export type WorkspaceGateStatus = (typeof WORKSPACE_GATE_STATUSES)[number];

export interface WorkspaceGateFacts {
  hasPersonalWorkspace: boolean;
  hasOrganizationMembership: boolean;
  hasPendingOrganizationInvites: boolean;
}

export interface WorkspaceGate extends WorkspaceGateFacts {
  gate: WorkspaceGateStatus;
}

/**
 * Single resolver for the workspace gate. Personal workspace and/or any
 * organization membership is `ready` (pending invites ignored). Otherwise
 * pending org invitations yield `pending-invites`; else identity onboarding.
 */
export function deriveWorkspaceGate(
  facts: WorkspaceGateFacts,
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
 * Loads gate facts for a user and derives the workspace gate.
 * Pending invites: non-expired PENDING organization invitations for the user's
 * email (trim + lowercase). Join-link mid-flow is not counted here.
 */
export async function loadWorkspaceGate(
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<WorkspaceGate> {
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

  const facts: WorkspaceGateFacts = {
    hasPersonalWorkspace: personalWorkspace != null,
    hasOrganizationMembership: membership != null,
    hasPendingOrganizationInvites: pendingInvite != null,
  };

  return {
    ...facts,
    gate: deriveWorkspaceGate(facts),
  };
}
