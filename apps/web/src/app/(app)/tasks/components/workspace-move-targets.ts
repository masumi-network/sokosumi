import type { MemberWithOrganization } from "@/lib/types/core-dto";

export interface WorkspaceMoveTargetBase {
  id: string;
  organizationId: string | null;
  organization?: MemberWithOrganization["organization"];
}

export function buildWorkspaceMoveTargets(
  currentOrganizationId: string | null | undefined,
  organizations: MemberWithOrganization[] | undefined,
): WorkspaceMoveTargetBase[] {
  const members = organizations ?? [];
  const options: WorkspaceMoveTargetBase[] = [];
  if (currentOrganizationId != null) {
    options.push({ id: "personal", organizationId: null });
  }
  for (const member of members) {
    if (member.organization.id !== currentOrganizationId) {
      options.push({
        id: member.organization.id,
        organizationId: member.organization.id,
        organization: member.organization,
      });
    }
  }
  return options;
}

export function getWorkspaceMoveTargetCount(
  currentOrganizationId: string | null | undefined,
  organizations: MemberWithOrganization[] | undefined,
): number {
  return buildWorkspaceMoveTargets(currentOrganizationId, organizations).length;
}
