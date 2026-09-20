import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import { fetchOrganizationWorkspaces } from "../../src/api/services/organization-workspace-service.js";
import { fetchAdministeredVendors } from "../../src/api/services/vendor-service.js";

function client(paths: string[], response: unknown): CoreHttpClient {
  return {
    get: async <T>(path: string) => {
      paths.push(path);
      return response as T;
    },
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    delete: async <T>() => ({}) as T,
  };
}

test("vendor and organization workspace services use the current-user Core routes", async () => {
  const vendorPaths: string[] = [];
  const workspacePaths: string[] = [];
  const { vendors } = await fetchAdministeredVendors(
    client(vendorPaths, {
      data: [{ id: "vendor-1", name: "Acme", role: "admin" }],
    }),
  );
  const { organizationWorkspaces } = await fetchOrganizationWorkspaces(
    client(workspacePaths, {
      data: [
        {
          id: "org-1",
          name: "Acme Organization",
          slug: "acme",
          role: "owner",
        },
      ],
    }),
  );

  assert.deepEqual(vendorPaths, ["/v1/vendors/me"]);
  assert.deepEqual(workspacePaths, ["/v1/users/me/organizations"]);
  assert.equal(vendors[0]?.id, "vendor-1");
  assert.equal(vendors[0]?.role, "admin");
  assert.equal(organizationWorkspaces[0]?.organizationId, "org-1");
  assert.equal("id" in (organizationWorkspaces[0] ?? {}), false);
  assert.equal(organizationWorkspaces[0]?.slug, "acme");
  assert.equal(organizationWorkspaces[0]?.role, "owner");
});

test("TestV79 vendor discovery returns only administered vendors", async () => {
  const { vendors } = await fetchAdministeredVendors(
    client([], {
      data: [
        { id: "vendor-admin", name: "Admin", role: "admin" },
        { id: "vendor-developer", name: "Developer", role: "developer" },
      ],
    }),
  );

  assert.deepEqual(
    vendors.map((vendor) => vendor.id),
    ["vendor-admin"],
  );
});

test("TestV79 discovery rejects malformed data and missing identities", async () => {
  await assert.rejects(
    fetchAdministeredVendors(client([], { data: null })),
    /vendor response.*array/i,
  );
  await assert.rejects(
    fetchOrganizationWorkspaces(client([], { data: {} })),
    /organization workspace response.*array/i,
  );
  await assert.rejects(
    fetchAdministeredVendors(
      client([], { data: [{ name: "Missing identity", role: "admin" }] }),
    ),
    /vendor response.*id/i,
  );
  await assert.rejects(
    fetchOrganizationWorkspaces(
      client([], { data: [{ name: "Missing identity", role: "owner" }] }),
    ),
    /organization workspace response.*id/i,
  );
});
