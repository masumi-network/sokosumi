/** Invitation row wins when a recovered join cookie points at the same org. */
export function isJoinLinkDuplicateOfInvitation(
  invitationSlugs: readonly string[],
  joinSlug: string,
): boolean {
  return invitationSlugs.includes(joinSlug);
}

/**
 * Pending-invites surface wins over identity onboarding whenever the user
 * still has an org-entry item: Core email invitations or a recovered join
 * link. Chat guest invitations never appear here.
 */
export function shouldShowPendingInvitesQueue(input: {
  gate: string | null;
  invitationCount: number;
  hasJoinLink: boolean;
}): boolean {
  if (input.gate === "pending-invites") {
    return true;
  }
  return input.invitationCount > 0 || input.hasJoinLink;
}

export type WorkspaceGateSurface =
  | "unavailable"
  | "pending-invites"
  | "identity-onboarding";

/**
 * `pending-invites` with a failed list and no recovered join item is a
 * temporary load failure, not an empty queue.
 */
export function resolveWorkspaceGateSurface(input: {
  workspaceAccessLoadFailed: boolean;
  gate: string | null;
  invitationCount: number;
  invitationsLoadFailed: boolean;
  hasJoinLink: boolean;
}): WorkspaceGateSurface {
  if (input.workspaceAccessLoadFailed) {
    return "unavailable";
  }
  if (
    input.gate === "pending-invites" &&
    input.invitationCount === 0 &&
    input.invitationsLoadFailed &&
    !input.hasJoinLink
  ) {
    return "unavailable";
  }
  if (
    shouldShowPendingInvitesQueue({
      gate: input.gate,
      invitationCount: input.invitationCount,
      hasJoinLink: input.hasJoinLink,
    })
  ) {
    return "pending-invites";
  }
  return "identity-onboarding";
}
