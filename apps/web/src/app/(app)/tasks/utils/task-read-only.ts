import { isTaskArchivableStatus } from "@sokosumi/utils";

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
  /**
   * Paid organization workstation access. Personal and free orgs are true.
   * When false, the viewer may read the task but not comment, assign, or edit.
   */
  canUseWorkstation?: boolean;
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
  canUseWorkstation = true,
}: ReadOnlyForViewerParams): boolean {
  if (forceReadOnly || isGrantPendingStatus(taskStatus) || !canUseWorkstation) {
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

/**
 * Any org-workspace collaborator may archive a scheduled task they do not own
 * (mirrors Core scheduled-archive active-workspace gate, same as cancel).
 * Parked (`GRANT_PENDING`) stays on {@link canArchiveParkedTaskForViewer}
 * (owner/admin only). Viewer only sees tasks in the active workspace.
 */
export function canArchiveScheduledTaskForViewer({
  forceReadOnly,
  taskStatus,
  isTaskOwner,
  taskWorkspaceOrganizationId,
  hasActiveSchedule,
}: {
  forceReadOnly: boolean;
  taskStatus: string;
  isTaskOwner: boolean;
  taskWorkspaceOrganizationId: string | null;
  hasActiveSchedule: boolean;
}): boolean {
  if (forceReadOnly || isTaskOwner || isGrantPendingStatus(taskStatus)) {
    return false;
  }

  if (taskWorkspaceOrganizationId === null) {
    return false;
  }

  if (!hasActiveSchedule || !isTaskArchivableStatus(taskStatus)) {
    return false;
  }

  return true;
}

type OrgCollaboratorViewerParams = ReadOnlyForViewerParams;

/**
 * Owner or authenticated org-workspace collaborator, excluding force-read-only
 * and parked (`GRANT_PENDING`) tasks. Shared by comment and cancel gates.
 */
function canOrgCollaboratorActOnTaskForViewer({
  taskWorkspaceOrganizationId,
  taskOwnerId,
  sessionUserId,
  forceReadOnly,
  taskStatus,
}: OrgCollaboratorViewerParams): boolean {
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

/**
 * Organization workspace collaborators may comment without owning the task.
 * Mutations stay gated by {@link isReadOnlyForViewer}.
 */
export function canCommentOnTaskForViewer(
  params: OrgCollaboratorViewerParams,
): boolean {
  if (params.canUseWorkstation === false) {
    return false;
  }
  return canOrgCollaboratorActOnTaskForViewer(params);
}

/**
 * Organization workspace collaborators may cancel without owning the task.
 * Other mutations stay gated by {@link isReadOnlyForViewer}.
 */
export function canCancelTaskForViewer(
  params: OrgCollaboratorViewerParams,
): boolean {
  return canOrgCollaboratorActOnTaskForViewer(params);
}
