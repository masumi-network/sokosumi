import { TaskStatus } from "@/lib/clients/generated/core";

interface ReadOnlyForViewerParams {
  /** Organization of the task's workspace; `null` for a personal workspace. */
  taskWorkspaceOrganizationId: string | null;
  /** Owner of the task. */
  taskOwnerId: string;
  /** Viewer's user id, or null/undefined when unauthenticated. */
  sessionUserId: string | null | undefined;
  /**
   * Locks the view read-only regardless of ownership. Set by the admin task
   * detail view, where the viewer is never the owner and must not be able to
   * edit, comment, or mutate the task.
   */
  forceReadOnly: boolean;
  taskStatus: string;
}

function isGrantPendingStatus(status: string): boolean {
  return status === TaskStatus.GRANT_PENDING;
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
  taskOwnerId,
  sessionUserId,
  forceReadOnly,
  taskStatus,
}: ReadOnlyForViewerParams): boolean {
  if (forceReadOnly || isGrantPendingStatus(taskStatus)) {
    return true;
  }
  return taskWorkspaceOrganizationId !== null && sessionUserId !== taskOwnerId;
}

export function canArchiveParkedTaskForViewer({
  forceReadOnly,
  taskStatus,
  isTaskOwner,
  isOrgOwnerOrAdmin,
}: {
  forceReadOnly: boolean;
  taskStatus: string;
  isTaskOwner: boolean;
  isOrgOwnerOrAdmin: boolean;
}): boolean {
  if (forceReadOnly || !isGrantPendingStatus(taskStatus)) {
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
  taskOwnerId,
  sessionUserId,
  forceReadOnly,
  taskStatus,
}: CanCommentOnTaskForViewerParams): boolean {
  if (forceReadOnly || isGrantPendingStatus(taskStatus)) {
    return false;
  }

  if (sessionUserId === taskOwnerId) {
    return true;
  }

  return (
    taskWorkspaceOrganizationId !== null &&
    sessionUserId !== null &&
    sessionUserId !== undefined
  );
}

type CanCancelTaskForViewerParams = ReadOnlyForViewerParams;

/**
 * Organization workspace collaborators may cancel without owning the task.
 * Other mutations stay gated by {@link isReadOnlyForViewer}.
 */
export function canCancelTaskForViewer({
  taskWorkspaceOrganizationId,
  taskOwnerId,
  sessionUserId,
  forceReadOnly,
  taskStatus,
}: CanCancelTaskForViewerParams): boolean {
  if (forceReadOnly || isGrantPendingStatus(taskStatus)) {
    return false;
  }

  if (sessionUserId === taskOwnerId) {
    return true;
  }

  return (
    taskWorkspaceOrganizationId !== null &&
    sessionUserId !== null &&
    sessionUserId !== undefined
  );
}
