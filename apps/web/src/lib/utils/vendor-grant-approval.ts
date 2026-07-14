import type { MemberWithOrganization } from "@/lib/clients/generated/core";

export function resolveViewerOrganizationMembership(
  organizationId: string | null,
  members: MemberWithOrganization[],
): MemberWithOrganization | undefined {
  if (organizationId === null) {
    return undefined;
  }

  return members.find((member) => member.organizationId === organizationId);
}

export function canApproveVendorGrants(params: {
  organizationId: string | null;
  isAuthenticated: boolean;
  viewerMembership?: MemberWithOrganization;
}): boolean {
  if (!params.isAuthenticated) {
    return false;
  }

  if (params.organizationId === null) {
    return true;
  }

  const role = params.viewerMembership?.role;
  return role === "owner" || role === "admin";
}

export function buildVendorGrantReviewHref(params: {
  organizationId: string | null;
  organizationSlug?: string | null;
}): string | null {
  if (params.organizationId === null) {
    return "/account#vendor-workspace-access";
  }

  if (params.organizationSlug) {
    return `/organizations/${params.organizationSlug}#vendor-workspace-access`;
  }

  return `/organizations/${params.organizationId}#vendor-workspace-access`;
}
