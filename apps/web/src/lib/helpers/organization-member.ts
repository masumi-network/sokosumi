import { MemberRole } from "@/lib/clients/generated/core";

export function isOrganizationOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}
