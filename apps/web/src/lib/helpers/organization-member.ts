import { MemberRole } from "@sokosumi/utils";

export function isOrganizationOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}
