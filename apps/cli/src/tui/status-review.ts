import type { OrganizationWorkspace } from "../api/models/organization-workspace.js";
import type { Vendor } from "../api/models/vendor.js";

export function vendorMembershipCaption(loading: boolean): string {
  return loading
    ? "Loading vendor memberships…"
    : "Vendor memberships from Core. Review only.";
}

export function workspaceMembershipCaption(loading: boolean): string {
  return loading
    ? "Loading organization workspaces…"
    : "Organization workspaces from Core. Review only.";
}

export function formatVendorReviewLine(vendor: Vendor): string {
  return `${vendor.name || "Unnamed vendor"} · ${vendor.role || "unknown"} · ${vendor.id}`;
}

export function formatWorkspaceReviewLine(
  workspace: OrganizationWorkspace,
): string {
  return `${workspace.name || "Unnamed workspace"} · ${workspace.role || workspace.slug || "unknown"} · ${workspace.organizationId}`;
}
