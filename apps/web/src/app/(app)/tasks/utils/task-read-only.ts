import { TaskStatus } from "@sokosumi/core-client";

interface ReadOnlyForViewerParams {
  /**
   * Locks the view read-only regardless of who is responsible. Set by the admin
   * task detail view, where the viewer is never responsible and must not be able to
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
  /** Responsible person of the task, from Core; `null` when nobody is. */
  responsibleUserId: string | null;
  /** Viewer's user id, or null/undefined when unauthenticated. */
  sessionUserId: string | null | undefined;
}

function isGrantPendingStatus(status: string): boolean {
  return status === TaskStatus.GRANT_PENDING;
}

/**
 * Whether the task detail view is read-only for this viewer. Every member may
 * act on an organization-workspace task, not just the responsible person; a
 * personal-workspace task is only reachable by its Owner, who is then the
 * responsible person.
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
 * A parked task can still be archived: by its responsible person, or by any seated member
 * when it sits in an organization workspace.
 */
export function canArchiveParkedTaskForViewer({
  forceReadOnly,
  taskStatus,
  isResponsible,
  isOrganizationTask,
  hasAssignedSeat,
}: {
  forceReadOnly: boolean;
  taskStatus: string;
  isResponsible: boolean;
  isOrganizationTask: boolean;
  hasAssignedSeat: boolean;
}): boolean {
  if (forceReadOnly || !isGrantPendingStatus(taskStatus)) {
    return false;
  }

  return isResponsible || (isOrganizationTask && hasAssignedSeat);
}

/**
 * Responsible person or authenticated org-workspace collaborator, excluding
 * force-read-only and parked (`GRANT_PENDING`) tasks. Shared by comment and
 * cancel gates.
 */
function canOrgCollaboratorActOnTaskForViewer({
  taskWorkspaceOrganizationId,
  responsibleUserId,
  sessionUserId,
  forceReadOnly,
  taskStatus,
}: OrgCollaboratorViewerParams): boolean {
  if (forceReadOnly || isGrantPendingStatus(taskStatus)) {
    return false;
  }

  if (responsibleUserId !== null && sessionUserId === responsibleUserId) {
    return true;
  }

  return (
    taskWorkspaceOrganizationId !== null &&
    sessionUserId !== null &&
    sessionUserId !== undefined
  );
}

/**
 * Organization workspace collaborators may comment without being responsible for the task,
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
 * Organization workspace collaborators may cancel without being responsible for the task,
 * even without an assigned seat. Other mutations use
 * {@link isReadOnlyForViewer}.
 */
export function canCancelTaskForViewer(
  params: OrgCollaboratorViewerParams,
): boolean {
  return canOrgCollaboratorActOnTaskForViewer(params);
}
