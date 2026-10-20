import { MemberRole } from "@sokosumi/core-client";

export function isOrganizationOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

/** True when this viewer is an owner or admin of `organizationId`. */
export function viewerIsOrganizationOwnerOrAdmin(
  organizationId: string | null | undefined,
  memberships: readonly { organizationId: string; role: string }[] | undefined,
): boolean {
  if (organizationId == null || memberships == null) {
    return false;
  }
  const membership = memberships.find(
    (member) => member.organizationId === organizationId,
  );
  return membership != null && isOrganizationOwnerOrAdmin(membership.role);
}
