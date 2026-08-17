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
