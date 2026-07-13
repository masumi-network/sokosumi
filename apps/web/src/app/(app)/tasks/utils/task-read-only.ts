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
}

/**
 * The task detail view is read-only unless the viewer owns the task.
 *
 * - `forceReadOnly` (admin view) always wins.
 * - Otherwise: read-only for a non-owner on an organization-workspace task
 *   (workspace collaborators inspect but do not edit). Personal-workspace owners
 *   and organization-task owners stay editable.
 */
export function isReadOnlyForViewer({
  taskWorkspaceOrganizationId,
  taskUserId,
  sessionUserId,
  forceReadOnly,
}: ReadOnlyForViewerParams): boolean {
  if (forceReadOnly) {
    return true;
  }
  return taskWorkspaceOrganizationId !== null && sessionUserId !== taskUserId;
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
}: CanCommentOnTaskForViewerParams): boolean {
  if (forceReadOnly) {
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
