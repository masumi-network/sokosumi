import type { OrganizationWorkspace } from "../api/models/organization-workspace.js";
import type { Vendor } from "../api/models/vendor.js";

/** Vendors the developer may register a Coworker under (V67, V79). */
export function administeredVendors(vendors: readonly Vendor[]): Vendor[] {
  return vendors.filter((vendor) => vendor.role === "admin");
}

/**
 * Private registration requires at least one organization workspace (V67).
 * Does not invent a Workspace row; candidates come from `/v1/users/me/organizations`.
 */
export function requireOrganizationWorkspacesForRegistration(
  workspaces: readonly OrganizationWorkspace[],
): void {
  if (workspaces.length === 0) {
    throw new Error(
      "Registration requires an organization workspace. Create or join an organization first, then run `sokosumi workspaces list`.",
    );
  }
}

/**
 * Registration may use only a Vendor the developer administers.
 * Foreign or non-admin memberships are rejected before Core create.
 */
export function requireAdministeredVendorForRegistration(
  vendors: readonly Vendor[],
  vendorId: string,
): Vendor {
  const trimmed = vendorId.trim();
  const vendor = vendors.find((candidate) => candidate.id === trimmed);
  if (!vendor) {
    throw new Error(
      `Vendor ${trimmed} is not in your memberships. Run \`sokosumi vendors me\` and choose a Vendor you administer.`,
    );
  }
  if (vendor.role !== "admin") {
    throw new Error(
      `Vendor ${trimmed} role is ${vendor.role ?? "unknown"}; registration requires admin.`,
    );
  }
  return vendor;
}

/**
 * Vendor creation: require explicit confirmation, then refuse.
 * Core only exposes platform-admin create (`POST /v1/admin/vendors`);
 * do not invent a CLI-only self-service path (SOK-966 PR2).
 */
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
    "Core has no developer self-service Vendor create path. Administer an existing Vendor or ask a platform admin.",
  );
}
