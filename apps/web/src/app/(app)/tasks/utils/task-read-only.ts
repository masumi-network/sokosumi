interface ReadOnlyForViewerParams {
  /** Organization of the task's workspace; `null` for a personal workspace. */
  taskWorkspaceOrganizationId: string | null;
  /** Owner of the task. */
  taskUserId: string;
  /** Viewer's user id, or null/undefined when unauthenticated. */
  sessionUserId: string | null | undefined;
  /**
   * Locks the view read-only regardless of ownership. Set by the admin task
   * detail view, where the viewer is never the owner and must not be able to
   * edit, comment, or mutate the task.
   */
  forceReadOnly: boolean;
  /** Task is waiting on vendor workspace grant approval. */
  pendingApproval?: boolean;
}

/**
 * The task detail view is read-only unless the viewer owns the task.
 *
 * - `forceReadOnly` (admin view) always wins.
 * - `pendingApproval` blocks mutations until vendor access is granted
 *   (archive stays separately exempt via {@link canArchiveParkedTaskForViewer}).
 * - Otherwise: read-only for a non-owner on an organization-workspace task
 *   (workspace collaborators inspect but do not edit). Personal-workspace owners
 *   and organization-task owners stay editable.
 */
export function isReadOnlyForViewer({
  taskWorkspaceOrganizationId,
  taskUserId,
  sessionUserId,
  forceReadOnly,
  pendingApproval = false,
}: ReadOnlyForViewerParams): boolean {
  if (forceReadOnly || pendingApproval) {
    return true;
  }
  return taskWorkspaceOrganizationId !== null && sessionUserId !== taskUserId;
}

/**
 * Soft-archive while parked is allowed for the task owner and for org
 * OWNER/ADMIN of that workspace. Mirrors Core `requireTaskArchiveAccess`.
 * Does not unlock other mutations — API remains the gate.
 */
export function canArchiveParkedTaskForViewer({
  forceReadOnly,
  pendingApproval = false,
  isTaskOwner,
  isOrgOwnerOrAdmin,
}: {
  forceReadOnly: boolean;
  pendingApproval?: boolean;
  isTaskOwner: boolean;
  isOrgOwnerOrAdmin: boolean;
}): boolean {
  if (forceReadOnly || !pendingApproval) {
    return false;
  }

  return isTaskOwner || isOrgOwnerOrAdmin;
}

type CanCommentOnTaskForViewerParams = ReadOnlyForViewerParams;

/**
 * Organization workspace collaborators may comment without owning the task.
 * Mutations stay gated by {@link isReadOnlyForViewer}.
 */
export function canCommentOnTaskForViewer({
  taskWorkspaceOrganizationId,
  taskUserId,
  sessionUserId,
  forceReadOnly,
  pendingApproval = false,
}: CanCommentOnTaskForViewerParams): boolean {
  if (forceReadOnly || pendingApproval) {
    return false;
  }

  if (sessionUserId === taskUserId) {
    return true;
  }

  return (
    taskWorkspaceOrganizationId !== null &&
    sessionUserId !== null &&
    sessionUserId !== undefined
  );
}
