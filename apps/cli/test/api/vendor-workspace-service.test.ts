import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  fetchOrganizationCallerSeat,
  fetchOrganizationWorkspaces,
} from "../../src/api/services/organization-workspace-service.js";
import { fetchVendorMemberships } from "../../src/api/services/vendor-service.js";

function client(paths: string[], response: unknown): CoreHttpClient {
  return {
    get: async <T>(path: string) => {
      paths.push(path);
      return response as T;
    },
    post: async <T>() => ({}) as T,
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({}) as T,
  };
}

test("vendor and organization workspace services use the current-user Core routes", async () => {
  const vendorPaths: string[] = [];
  const workspacePaths: string[] = [];
  const { vendors } = await fetchVendorMemberships(
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

test("vendor discovery preserves membership roles", async () => {
  const { vendors } = await fetchVendorMemberships(
    client([], {
      data: [
        { id: "vendor-admin", name: "Admin", role: "admin" },
        { id: "vendor-developer", name: "Developer", role: "developer" },
      ],
    }),
  );

  assert.deepEqual(
    vendors.map((vendor) => ({ id: vendor.id, role: vendor.role })),
    [
      { id: "vendor-admin", role: "admin" },
      { id: "vendor-developer", role: "developer" },
    ],
  );
});

test("discovery rejects malformed data and missing identities", async () => {
  await assert.rejects(
    fetchVendorMemberships(client([], { data: null })),
    /vendor response.*array/i,
  );
  await assert.rejects(
    fetchOrganizationWorkspaces(client([], { data: {} })),
    /organization workspace response.*array/i,
  );
  await assert.rejects(
    fetchVendorMemberships(
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

test("Seat checks encode the selected organization and return only Core's boolean", async () => {
  for (const assigned of [true, false]) {
    const paths: string[] = [];
    assert.equal(
      await fetchOrganizationCallerSeat(
        client(paths, { data: { assigned, credits: 999 } }),
        "org/a?b#c",
      ),
      assigned,
    );
    assert.deepEqual(paths, [
      "/v1/organizations/org%2Fa%3Fb%23c/members/me/seat",
    ]);
  }
});

test("Seat checks reject missing IDs and path traversal before requesting Core", async () => {
  const paths: string[] = [];
  for (const organizationId of ["", "  ", ".", ".."]) {
    await assert.rejects(
      fetchOrganizationCallerSeat(
        client(paths, { data: { assigned: true } }),
        organizationId,
      ),
      /Organization ID is required/,
    );
  }
  assert.deepEqual(paths, []);
});

test("Seat checks reject malformed or unwrapped responses without exposing content", async () => {
  for (const response of [
    null,
    { assigned: true },
    { data: null },
    { data: [] },
    { data: {} },
    { data: { assigned: "secret-value" } },
    { data: { assigned: 1 } },
  ]) {
    await assert.rejects(
      fetchOrganizationCallerSeat(client([], response), "org-1"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /expected assigned boolean/);
        assert.doesNotMatch(error.message, /secret-value/);
        return true;
      },
    );
  }
});

test("Seat checks retain the Core failure and never retry", async () => {
  const failure = new Error("Core unavailable");
  let reads = 0;
  const api = client([], {});
  api.get = async () => {
    reads++;
    throw failure;
  };
  await assert.rejects(
    fetchOrganizationCallerSeat(api, "org-1"),
    (error) => error === failure,
  );
  assert.equal(reads, 1);
});

test("Seat checks stop before Core when already canceled", async () => {
  const paths: string[] = [];
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchOrganizationCallerSeat(client(paths, {}), "org-1", controller.signal),
    { name: "AbortError" },
  );
  assert.deepEqual(paths, []);
});

test("Seat checks bound the request and combine timeout with caller cancellation", async (t) => {
  for (const cancelSource of ["timeout", "caller"] as const) {
    const caller = new AbortController();
    const timeout = new AbortController();
    const timeoutMock = t.mock.method(
      AbortSignal,
      "timeout",
      (duration: number) => {
        assert.equal(duration, 15_000);
        return timeout.signal;
      },
    );
    let reads = 0;
    const api = client([], {});
    api.get = async <T>(_path: string, signal?: AbortSignal) => {
      reads++;
      assert.ok(signal);
      assert.notEqual(signal, caller.signal);
      if (cancelSource === "timeout") timeout.abort();
      else caller.abort();
      assert.equal(signal.aborted, true);
      return { data: { assigned: true } } as T;
    };
    await assert.rejects(
      fetchOrganizationCallerSeat(api, "org-1", caller.signal),
      {
        name: "AbortError",
      },
    );
    assert.equal(reads, 1);
    timeoutMock.mock.restore();
  }
});
