export interface WorkspaceGateQueueInvitation {
  kind: "invitation";
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}

export interface WorkspaceGateQueueJoinLink {
  kind: "join";
  token: string;
  organizationName: string;
  organizationSlug: string;
}

export type WorkspaceGateQueueItem =
  | WorkspaceGateQueueInvitation
  | WorkspaceGateQueueJoinLink;

export type PendingInvitesBatchMode = "all" | "selected";

/** Invitation row wins when a recovered join cookie points at the same org. */
export function isJoinLinkDuplicateOfInvitation(
  invitationSlugs: readonly string[],
  joinSlug: string,
): boolean {
  return invitationSlugs.includes(joinSlug);
}

export function queueItemKey(item: WorkspaceGateQueueItem): string {
  return item.kind === "invitation" ? item.id : item.token;
}

/** Accept all / Accept selected only when more than one invite is pending. */
export function shouldShowPendingInvitesBatchActions(
  itemCount: number,
): boolean {
  return itemCount > 1;
}

export function itemsForBatchAccept(
  items: readonly WorkspaceGateQueueItem[],
  mode: PendingInvitesBatchMode,
  selectedKeys: ReadonlySet<string>,
): WorkspaceGateQueueItem[] {
  if (mode === "all") {
    return [...items];
  }
  return items.filter((item) => selectedKeys.has(queueItemKey(item)));
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

export type PendingInvitesDescriptionKey =
  | "pendingInvitesDescriptionInvitations"
  | "pendingInvitesDescriptionJoin"
  | "pendingInvitesDescriptionBoth";

/** Header copy matches the actions currently in the queue, not every possible path. */
export function pendingInvitesDescriptionKey(input: {
  invitationCount: number;
  hasJoinLink: boolean;
}): PendingInvitesDescriptionKey {
  if (input.hasJoinLink && input.invitationCount > 0) {
    return "pendingInvitesDescriptionBoth";
  }
  if (input.hasJoinLink) {
    return "pendingInvitesDescriptionJoin";
  }
  return "pendingInvitesDescriptionInvitations";
}

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
