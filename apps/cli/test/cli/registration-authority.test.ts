import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationWorkspace } from "../../src/api/models/organization-workspace.js";
import type { Vendor } from "../../src/api/models/vendor.js";
import {
  describeRegistrationAdminVendorRequirement,
  describeRegistrationWorkspaceRequirement,
  isPreprodCoworkerRegistrationTarget,
  requireAdministeredVendorForRegistration,
  requireOrganizationWorkspacesForRegistration,
  requirePreprodCoworkerRegistration,
  requireSelectedOrganizationWorkspace,
} from "../../src/cli/registration-authority.js";

function vendor(partial: Partial<Vendor> & Pick<Vendor, "id">): Vendor {
  return {
    createdAt: null,
    updatedAt: null,
    name: partial.name ?? partial.id,
    slug: null,
    logos: { light: null, dark: null },
    role: null,
    ...partial,
  };
}

function workspace(organizationId: string): OrganizationWorkspace {
  return {
    organizationId,
    createdAt: null,
    name: organizationId,
    slug: null,
    logo: null,
    role: "owner",
  };
}

test("empty organization workspaces block registration", () => {
  assert.throws(
    () => requireOrganizationWorkspacesForRegistration([]),
    /organization workspace/,
  );
  assert.doesNotThrow(() =>
    requireOrganizationWorkspacesForRegistration([workspace("org-1")]),
  );
});

test("registration selects only a listed Workspace", () => {
  const workspaces = [workspace("org-1")];
  assert.equal(
    requireSelectedOrganizationWorkspace(workspaces, "org-1"),
    workspaces[0],
  );
  assert.throws(
    () => requireSelectedOrganizationWorkspace(workspaces, "org-2"),
    /not in your organization memberships/,
  );
  assert.throws(
    () => requireSelectedOrganizationWorkspace(workspaces, undefined),
    /workspace id is required/,
  );
});

test("Coworker registration is limited to Preprod", () => {
  assert.equal(isPreprodCoworkerRegistrationTarget("preprod"), true);
  assert.equal(isPreprodCoworkerRegistrationTarget("mainnet"), false);
  assert.equal(isPreprodCoworkerRegistrationTarget("custom"), false);
  assert.doesNotThrow(() => requirePreprodCoworkerRegistration("preprod"));
  assert.throws(
    () => requirePreprodCoworkerRegistration("mainnet"),
    /Preprod only/,
  );
});

test("registration accepts only an administered Vendor", () => {
  const vendors = [
    vendor({ id: "v-admin", role: "admin" }),
    vendor({ id: "v-dev", role: "developer" }),
  ];
  assert.equal(
    requireAdministeredVendorForRegistration(vendors, "v-admin").id,
    "v-admin",
  );
  assert.throws(
    () => requireAdministeredVendorForRegistration(vendors, "v-dev"),
    /requires admin/,
  );
  assert.throws(
    () => requireAdministeredVendorForRegistration(vendors, "foreign"),
    /not in your memberships/,
  );
});

test("registration gate copy provides workspace and Vendor setup guidance", () => {
  assert.match(
    describeRegistrationWorkspaceRequirement(),
    /workspace switcher/,
  );
  const vendorGuidance = describeRegistrationAdminVendorRequirement();
  assert.match(vendorGuidance, /vendors create/);
  assert.match(vendorGuidance, /On Preprod, provision a private Coworker/);
  assert.doesNotMatch(vendorGuidance, /invite|role[- ]promot(e|ion)/i);
  assert.doesNotMatch(vendorGuidance, /create is unavailable/);
  assert.doesNotMatch(vendorGuidance, /\/developer\/vendors/);
  assert.match(
    vendorGuidance,
    /Vendors appears only after you already have admin/,
  );
});
