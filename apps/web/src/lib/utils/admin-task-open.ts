interface CanOpenAdminTaskAsUserParams {
  taskUserId: string;
  /** Null for tasks in a personal workspace. */
  taskOrganizationId: string | null;
  sessionUserId: string | null;
  memberOrganizationIds: string[];
}

/**
 * Whether the admin viewing the admin task detail can open the task in the
 * user-facing task view. Mirrors the Core read rules for `GET /tasks/{id}`:
 * organization tasks are readable by organization members (the user-facing
 * page auto-switches the workspace), personal-workspace tasks only by their
 * owner. There is no admin bypass in Core, so anything else would land on a
 * 404 — surface that as a disabled action instead.
 */
export function canOpenAdminTaskAsUser({
  taskUserId,
  taskOrganizationId,
  sessionUserId,
  memberOrganizationIds,
}: CanOpenAdminTaskAsUserParams): boolean {
  if (!sessionUserId) {
    return false;
  }

  if (taskOrganizationId) {
    return memberOrganizationIds.includes(taskOrganizationId);
  }

  return taskUserId === sessionUserId;
}
