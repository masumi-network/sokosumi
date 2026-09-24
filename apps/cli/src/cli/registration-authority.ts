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

export function describeRegistrationAdminVendorRequirement(
  webUrl?: string,
): string {
  const base = trimWebBase(webUrl);
  const developerHome = base
    ? `Developer in the web app starts at ${base}${WEB_DEVELOPER_DEFAULT_ROUTE} (Docs, OAuth clients, API keys, Coworkers, Tasks). Vendors appears there only after you already have admin.`
    : "In the Sokosumi web app, Developer shows Docs, OAuth clients, API keys, Coworkers, and Tasks. Vendors appears only after you already have admin.";
  return `Registration requires Vendor role admin. Check memberships under Vendors here or \`sokosumi vendors me\`. Ask an existing Vendor admin to add you as admin on their Vendor (member invite or role promote). If no Vendor exists yet, ask a platform admin to create one and make you admin. ${developerHome}`;
}

export function requireOrganizationWorkspacesForRegistration(
  workspaces: readonly OrganizationWorkspace[],
  webUrl?: string,
): void {
  if (workspaces.length === 0) {
    throw new Error(describeRegistrationWorkspaceRequirement(webUrl));
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

export function assertVendorCreationRequest(options: {
  requested: boolean;
  confirmed: boolean;
}): void {
  if (!options.requested) return;
  if (!options.confirmed) {
    throw new Error(
      "Vendor creation requires explicit confirmation (`--confirm-create-vendor`).",
    );
  }
  throw new Error(
    "Core has no developer self-service Vendor create path yet. Ask an existing Vendor admin to add you as admin, or ask a platform admin to create a Vendor and make you admin.",
  );
}
