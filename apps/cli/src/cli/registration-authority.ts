import type { OrganizationWorkspace } from "../api/models/organization-workspace.js";
import type { Vendor } from "../api/models/vendor.js";

export const WEB_DEVELOPER_DEFAULT_ROUTE = "/developer/oauth-clients";

export function administeredVendors(vendors: readonly Vendor[]): Vendor[] {
  return vendors.filter((vendor) => vendor.role === "admin");
}

function trimWebBase(webUrl: string | undefined): string {
  return String(webUrl ?? "")
    .trim()
    .replace(/\/+$/g, "");
}

export function describeRegistrationWorkspaceRequirement(
  webUrl?: string,
): string {
  const base = trimWebBase(webUrl);
  const webStep = base
    ? `In the Sokosumi web app (${base}), use the workspace switcher to create or join an organization.`
    : "In the Sokosumi web app, use the workspace switcher to create or join an organization.";
  return `Registration requires an organization workspace. ${webStep} Then open Workspaces here or run \`sokosumi workspaces list\`.`;
}

/**
 * How to become a Vendor admin before registration.
 *
 * Primary unblock: create a Vendor (`sokosumi vendors create` / Core
 * `POST /v1/vendors`). Coworker create is still platform-admin only.
 * Web Developer → Vendors is hidden unless you already have admin membership
 * (`getDeveloperVendorAdminAccess`); do not send blocked users there.
 */
export function describeRegistrationAdminVendorRequirement(
  webUrl?: string,
): string {
  const base = trimWebBase(webUrl);
  const developerHome = base
    ? `Developer in the web app starts at ${base}${WEB_DEVELOPER_DEFAULT_ROUTE} (Docs, OAuth clients, API keys, Coworkers, Tasks). Vendors appears there only after you already have admin.`
    : "In the Sokosumi web app, Developer shows Docs, OAuth clients, API keys, Coworkers, and Tasks. Vendors appears only after you already have admin.";
  return `Registration requires Vendor role admin. Check memberships under Vendors here or \`sokosumi vendors me\`. Create one with \`sokosumi vendors create --name NAME --slug SLUG\`. Note: creating a Coworker still requires a platform admin. ${developerHome}`;
}

export function requireOrganizationWorkspacesForRegistration(
  workspaces: readonly OrganizationWorkspace[],
  webUrl?: string,
): void {
  if (workspaces.length === 0) {
    throw new Error(describeRegistrationWorkspaceRequirement(webUrl));
  }
}

export function requireSelectedOrganizationWorkspace(
  workspaces: readonly OrganizationWorkspace[],
  workspaceId: string | undefined,
): OrganizationWorkspace {
  const selectedId = workspaceId?.trim();
  if (!selectedId) {
    throw new Error(
      "workspace id is required. Run `sokosumi --preprod workspaces list` and pass its organization ID as --workspace-id.",
    );
  }
  const workspace = workspaces.find(
    (candidate) => candidate.organizationId === selectedId,
  );
  if (!workspace) {
    throw new Error(
      `Workspace ${selectedId} is not in your organization memberships. Run \`sokosumi workspaces list\` and choose one you belong to.`,
    );
  }
  return workspace;
}

export function isPreprodCoworkerRegistrationTarget(
  target: string | undefined,
): boolean {
  return target === "preprod";
}

export function requirePreprodCoworkerRegistration(
  target: string | undefined,
): void {
  if (!isPreprodCoworkerRegistrationTarget(target)) {
    throw new Error(
      "Coworker registration is Preprod only. Select Preprod with --preprod.",
    );
  }
}

export function requireAdministeredVendorForRegistration(
  vendors: readonly Vendor[],
  vendorId: string,
  webUrl?: string,
): Vendor {
  const trimmed = vendorId.trim();
  const vendor = vendors.find((candidate) => candidate.id === trimmed);
  if (!vendor) {
    throw new Error(
      `Vendor ${trimmed} is not in your memberships. ${describeRegistrationAdminVendorRequirement(webUrl)}`,
    );
  }
  if (vendor.role !== "admin") {
    throw new Error(
      `Vendor ${trimmed} role is ${vendor.role ?? "unknown"}; registration requires admin. ${describeRegistrationAdminVendorRequirement(webUrl)}`,
    );
  }
  return vendor;
}
