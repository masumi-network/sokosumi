import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationWorkspace } from "../../src/api/models/organization-workspace.js";
import type { Vendor } from "../../src/api/models/vendor.js";
import {
  administeredVendors,
  assertVendorCreationRequest,
  describeRegistrationAdminVendorRequirement,
  describeRegistrationWorkspaceRequirement,
  requireAdministeredVendorForRegistration,
  requireOrganizationWorkspacesForRegistration,
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

test("TestV67 administeredVendors keeps only admin memberships", () => {
  assert.deepEqual(
    administeredVendors([
      vendor({ id: "v-admin", role: "admin" }),
      vendor({ id: "v-dev", role: "developer" }),
      vendor({ id: "v-unknown", role: null }),
    ]).map((item) => item.id),
    ["v-admin"],
  );
});

test("TestV67 empty organization workspaces block registration", () => {
  assert.throws(
    () => requireOrganizationWorkspacesForRegistration([]),
    /organization workspace/,
  );
  assert.doesNotThrow(() =>
    requireOrganizationWorkspacesForRegistration([workspace("org-1")]),
  );
});

test("TestV67 registration accepts only an administered Vendor", () => {
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

test("TestV67 Vendor creation needs confirm then allows Core path", () => {
  assert.doesNotThrow(() =>
    assertVendorCreationRequest({ requested: false, confirmed: false }),
  );
  assert.throws(
    () => assertVendorCreationRequest({ requested: true, confirmed: false }),
    /explicit confirmation/,
  );
  assert.doesNotThrow(() =>
    assertVendorCreationRequest({ requested: true, confirmed: true }),
  );
});

test("TestV67 registration gate copy tells how to get workspace and Vendor admin", () => {
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
    /--create-vendor/,
  );
  assert.match(
    describeRegistrationAdminVendorRequirement("https://app.example.test"),
    /existing Vendor admin to add you as admin/,
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
