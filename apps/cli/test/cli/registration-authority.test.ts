import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationWorkspace } from "../../src/api/models/organization-workspace.js";
import type { Vendor } from "../../src/api/models/vendor.js";
import {
  administeredVendors,
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

test("administeredVendors keeps only admin memberships", () => {
  assert.deepEqual(
    administeredVendors([
      vendor({ id: "v-admin", role: "admin" }),
      vendor({ id: "v-dev", role: "developer" }),
      vendor({ id: "v-unknown", role: null }),
    ]).map((item) => item.id),
    ["v-admin"],
  );
});

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
    describeRegistrationWorkspaceRequirement("https://app.example.test"),
    /workspace switcher/,
  );
  assert.match(
    describeRegistrationWorkspaceRequirement("https://app.example.test"),
    /https:\/\/app\.example\.test/,
  );
  assert.match(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /vendors create/,
  );
  assert.match(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /creating a Coworker still requires a platform admin/,
  );
  assert.doesNotMatch(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /invite|role[- ]promot(e|ion)/i,
  );
  assert.doesNotMatch(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /create is unavailable/,
  );
  assert.match(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /oauth-clients/,
  );
  assert.doesNotMatch(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /\/developer\/vendors/,
  );
  assert.match(
    describeRegistrationAdminVendorRequirement(),
    /Vendors appears only after you already have admin/,
  );
});
