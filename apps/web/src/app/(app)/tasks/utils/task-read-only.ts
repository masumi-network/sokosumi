import { TaskStatus } from "@sokosumi/core-client";

interface ReadOnlyForViewerParams {
  /**
   * Locks the view read-only regardless of ownership. Set by the admin task
   * detail view, where the viewer is never the owner and must not be able to
   * edit, comment, or mutate the task.
   */
  forceReadOnly: boolean;
  taskStatus: string;
  /**
   * Paid assigned organization seat. Personal and free orgs are true.
   * When false, the viewer may read the task but not comment, assign, or edit.
   */
  hasAssignedSeat?: boolean;
}

interface OrgCollaboratorViewerParams extends ReadOnlyForViewerParams {
  /** Organization of the task's workspace; `null` for a personal workspace. */
  taskWorkspaceOrganizationId: string | null;
  /** Owner of the task. */
  taskOwnerId: string;
  /** Viewer's user id, or null/undefined when unauthenticated. */
  sessionUserId: string | null | undefined;
}

function isGrantPendingStatus(status: string): boolean {
  return status === TaskStatus.GRANT_PENDING;
}

/**
 * Whether the task detail view is read-only for this viewer. Every member may
 * act on an organization-workspace task, not just its owner; a
 * personal-workspace task is only reachable by its owner.
 *
 * Read-only for the admin view (`forceReadOnly`), a parked task, or a viewer
 * without an assigned seat.
 */
export function isReadOnlyForViewer({
  forceReadOnly,
  taskStatus,
  hasAssignedSeat = false,
}: ReadOnlyForViewerParams): boolean {
  return forceReadOnly || isGrantPendingStatus(taskStatus) || !hasAssignedSeat;
}

/**
 * A parked task can still be archived: by its owner, or by any seated member
 * when it sits in an organization workspace.
 */
export function canArchiveParkedTaskForViewer({
  forceReadOnly,
  taskStatus,
  isTaskOwner,
  isOrganizationTask,
  hasAssignedSeat,
}: {
  forceReadOnly: boolean;
  taskStatus: string;
  isTaskOwner: boolean;
  isOrganizationTask: boolean;
  hasAssignedSeat: boolean;
}): boolean {
  if (forceReadOnly || !isGrantPendingStatus(taskStatus)) {
    return false;
  }

  return isTaskOwner || (isOrganizationTask && hasAssignedSeat);
}

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
 * Organization workspace collaborators may comment without owning the task,
 * given an assigned seat. Other mutations use {@link isReadOnlyForViewer}.
 */
export function canCommentOnTaskForViewer(
  params: OrgCollaboratorViewerParams,
): boolean {
  if (params.hasAssignedSeat !== true) {
    return false;
  }
  return canOrgCollaboratorActOnTaskForViewer(params);
}

/**
 * Organization workspace collaborators may cancel without owning the task,
 * even without an assigned seat. Other mutations use
 * {@link isReadOnlyForViewer}.
 */
export function canCancelTaskForViewer(
  params: OrgCollaboratorViewerParams,
): boolean {
  return canOrgCollaboratorActOnTaskForViewer(params);
}
