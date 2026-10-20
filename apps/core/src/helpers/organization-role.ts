import { MemberRole } from "@sokosumi/database";

/**
 * Organization owner/admin elevation: channel lifecycle and settings, and the
 * management of shared Soko Bots. A room or bot creator is provenance only and
 * never authorizes.
 */
export function isOrganizationOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}
