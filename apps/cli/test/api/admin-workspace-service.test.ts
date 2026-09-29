import assert from "node:assert/strict";
import test from "node:test";

import {
  type CoreHttpClient,
  createApiError,
} from "../../src/api/http-client.js";
import {
  normalizeAdminEmail,
  validateAdminPathSegment,
} from "../../src/api/models/admin-workspace.js";
import {
  addAdminWorkspaceMember,
  assignAdminWorkspaceSeat,
  fetchAdminWorkspace,
  fetchAdminWorkspaceMembers,
  findAdminUserByEmail,
} from "../../src/api/services/admin-workspace-service.js";

interface Request {
  method: string;
  path: string;
  body?: unknown;
  signal?: AbortSignal;
}

function fixtureClient(
  handler: (request: Request) => unknown | Promise<unknown>,
): { client: CoreHttpClient; requests: Request[] } {
  const requests: Request[] = [];
  async function request<T>(value: Request): Promise<T> {
    requests.push(value);
    return (await handler(value)) as T;
  }
  return {
    requests,
    client: {
      get: (path, signal) => request({ method: "GET", path, signal }),
      post: (path, body, signal) =>
        request({ method: "POST", path, body, signal }),
      put: (path, body, signal) =>
        request({ method: "PUT", path, body, signal }),
      patch: (path, body, signal) =>
        request({ method: "PATCH", path, body, signal }),
    },
  };
}

function workspace(slug = "hackathon") {
  return {
    organization: {
      id: "org-1",
      slug,
      name: "Hackathon",
      stripeCustomerId: "private-customer",
    },
    billingPlan: { mode: "self_serve", plan: "pro", purchasedSeats: 2 },
    seatSummary: {
      purchasedSeats: 2,
      assignedCount: 1,
      unusedSeats: 1,
      memberCount: 2,
    },
    totalCredits: 1000,
    token: "hidden-secret",
  };
}

function member(id = "member-1", email = "dev@example.com") {
  return {
    id,
    organizationId: "org-1",
    role: "member",
    seatAssignedAt: null,
    user: { id: "user-1", name: "Developer", email, token: "hidden-secret" },
    subscriptionPlan: "pro",
  };
}

function page(data: unknown[], nextCursor: unknown = null) {
  return { data, meta: { pagination: { nextCursor }, requestId: "request-1" } };
}

test("admin Workspace detail uses the slug and allowlists output fields", async () => {
  const { client, requests } = fixtureClient(() => ({
    data: workspace("hack?2026"),
  }));
  const result = await fetchAdminWorkspace(client, "hack?2026");
  assert.deepEqual(result, {
    id: "org-1",
    name: "Hackathon",
    slug: "hack?2026",
    plan: "pro",
    billingMode: "self_serve",
    seatSummary: {
      purchasedSeats: 2,
      assignedCount: 1,
      unusedSeats: 1,
      memberCount: 2,
    },
  });
  assert.equal(requests[0]?.path, "/v1/admin/organizations/hack%3F2026");
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-customer|hidden-secret|totalCredits/,
  );
});

test("admin Workspace detail rejects malformed fields and mismatched slugs", async () => {
  const invalid = [
    null,
    workspace(),
    { data: workspace("other") },
    {
      data: {
        ...workspace(),
        billingPlan: { mode: "self_serve", plan: "unknown" },
      },
    },
    { data: { ...workspace(), billingPlan: { mode: "unknown", plan: "pro" } } },
    {
      data: {
        ...workspace(),
        billingPlan: { mode: "enterprise_contract", plan: "free" },
      },
    },
    {
      data: {
        ...workspace(),
        billingPlan: { mode: "self_serve", plan: "enterprise" },
      },
    },
    {
      data: {
        ...workspace(),
        seatSummary: { ...workspace().seatSummary, unusedSeats: -1 },
      },
    },
    {
      data: {
        ...workspace(),
        seatSummary: { ...workspace().seatSummary, memberCount: 0.5 },
      },
    },
    {
      data: {
        ...workspace(),
        organization: { ...workspace().organization, id: ".." },
      },
    },
  ];
  for (const response of invalid) {
    const { client } = fixtureClient(() => response);
    await assert.rejects(fetchAdminWorkspace(client, "hackathon"));
  }
});

test("admin members follow every page with limit 50 and encode cursors", async () => {
  let calls = 0;
  const { client, requests } = fixtureClient(() =>
    calls++ === 0
      ? page([member()], "next?&=cursor")
      : page([member("member-2", "second@example.com")]),
  );
  const result = await fetchAdminWorkspaceMembers(client, "hackathon");
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      "/v1/admin/organizations/hackathon/members?limit=50",
      "/v1/admin/organizations/hackathon/members?limit=50&cursor=next%3F%26%3Dcursor",
    ],
  );
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    id: "member-1",
    organizationId: "org-1",
    role: "member",
    seatAssignedAt: null,
    user: { id: "user-1", name: "Developer", email: "dev@example.com" },
  });
  assert.doesNotMatch(JSON.stringify(result), /hidden-secret|subscriptionPlan/);
});

test("admin member responses accept blank names permitted by Core", async () => {
  const data = { ...member(), user: { ...member().user, name: "" } };
  const listing = fixtureClient(() => page([data]));
  const creation = fixtureClient(() => ({ data }));
  assert.equal(
    (await fetchAdminWorkspaceMembers(listing.client, "hackathon"))[0]?.user
      .name,
    "",
  );
  assert.equal(
    (
      await addAdminWorkspaceMember(creation.client, "hackathon", "org-1", {
        id: "user-1",
        email: "dev@example.com",
      })
    ).user.name,
    "",
  );
});

test("exact email lookup checks all pages and ignores substring matches", async () => {
  let calls = 0;
  const { client, requests } = fixtureClient(() =>
    calls++ === 0
      ? page([{ id: "other", email: "prefix-dev@example.com" }], "user-cursor")
      : page([
          { id: "user-1", email: "Dev@Example.com", token: "hidden-secret" },
        ]),
  );
  assert.deepEqual(await findAdminUserByEmail(client, " DEV@example.com "), {
    id: "user-1",
    email: "Dev@Example.com",
  });
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      "/v1/admin/users?query=dev%40example.com&limit=50",
      "/v1/admin/users?query=dev%40example.com&limit=50&cursor=user-cursor",
    ],
  );
});

test("exact email lookup rejects ambiguous users across pages", async () => {
  let calls = 0;
  const { client, requests } = fixtureClient(() =>
    calls++ === 0
      ? page([{ id: "user-1", email: "dev@example.com" }], "next")
      : page([{ id: "user-2", email: "DEV@example.com" }]),
  );
  await assert.rejects(
    findAdminUserByEmail(client, "dev@example.com"),
    /More than one user/,
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("exact email lookup accepts repeated identical users and reports true absence only after the last page", async () => {
  let calls = 0;
  const { client } = fixtureClient(() =>
    page(
      [{ id: "user-1", email: "dev@example.com" }],
      calls++ === 0 ? "next" : null,
    ),
  );
  assert.equal(
    (await findAdminUserByEmail(client, "dev@example.com")).id,
    "user-1",
  );
  const absent = fixtureClient(() =>
    page([{ id: "other", email: "other@example.com" }]),
  );
  await assert.rejects(
    findAdminUserByEmail(absent.client, "dev@example.com"),
    /No user with this exact email/,
  );
});

test("admin pagination rejects missing and malformed pagination instead of declaring absence", async () => {
  for (const response of [
    { data: [] },
    { data: [], meta: {} },
    { data: [], meta: { pagination: {} } },
    page([], 7),
    page([], ""),
    page([], "bad\ncursor"),
    { ...page([]), data: null },
  ]) {
    const { client } = fixtureClient(() => response);
    await assert.rejects(
      findAdminUserByEmail(client, "dev@example.com"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /No user with this exact email/);
        return true;
      },
    );
  }
});

test("admin pagination stops on cursor cycles and the 100-page limit", async () => {
  const cycle = fixtureClient(() => page([], "same"));
  await assert.rejects(
    fetchAdminWorkspaceMembers(cycle.client, "hackathon"),
    /repeated a cursor.*incomplete/,
  );
  assert.equal(cycle.requests.length, 2);
  let calls = 0;
  const limit = fixtureClient(() => page([], `cursor-${calls++}`));
  await assert.rejects(
    findAdminUserByEmail(limit.client, "dev@example.com"),
    /exceeded 100 pages.*incomplete/,
  );
  assert.equal(limit.requests.length, 100);
});

test("admin pagination applies one 30-second timeout across all pages", async (t) => {
  const timeout = new AbortController();
  const timeoutMock = t.mock.method(
    AbortSignal,
    "timeout",
    (duration: number) => {
      assert.equal(duration, 30_000);
      return timeout.signal;
    },
  );
  let calls = 0;
  const { client, requests } = fixtureClient(() => {
    if (calls++ === 1) timeout.abort();
    return page([], "next");
  });
  await assert.rejects(fetchAdminWorkspaceMembers(client, "hackathon"), {
    name: "AbortError",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.signal, requests[1]?.signal);
  assert.equal(timeoutMock.mock.callCount(), 1);
});

test("admin calls stop on caller cancellation before any request", async () => {
  const caller = new AbortController();
  caller.abort();
  const { client, requests } = fixtureClient(() => ({}));
  await assert.rejects(
    fetchAdminWorkspace(client, "hackathon", caller.signal),
    { name: "AbortError" },
  );
  await assert.rejects(
    fetchAdminWorkspaceMembers(client, "hackathon", caller.signal),
    { name: "AbortError" },
  );
  await assert.rejects(
    findAdminUserByEmail(client, "dev@example.com", caller.signal),
    { name: "AbortError" },
  );
  await assert.rejects(
    addAdminWorkspaceMember(
      client,
      "hackathon",
      "org-1",
      { id: "user-1", email: "dev@example.com" },
      caller.signal,
    ),
    { name: "AbortError" },
  );
  await assert.rejects(
    assignAdminWorkspaceSeat(client, "hackathon", "member-1", caller.signal),
    { name: "AbortError" },
  );
  assert.deepEqual(requests, []);
});

test("admin paths and emails fail locally before any Core request", async () => {
  const { client, requests } = fixtureClient(() => ({}));
  for (const invalid of [
    "",
    " ",
    ".",
    "..",
    "one/two",
    "one\\two",
    "%2e%2e",
    "bad\nslug",
    "\nhackathon",
    "two words",
  ]) {
    await assert.rejects(fetchAdminWorkspace(client, invalid));
    await assert.rejects(fetchAdminWorkspaceMembers(client, invalid));
    await assert.rejects(
      assignAdminWorkspaceSeat(client, "hackathon", invalid),
    );
  }
  for (const invalid of [
    "",
    "missing-at",
    "a@@example.com",
    "dev@example.com\n",
    "bad name@example.com",
  ]) {
    await assert.rejects(
      findAdminUserByEmail(client, invalid),
      /valid developer email/,
    );
  }
  assert.equal(normalizeAdminEmail(" Dev@Example.com "), "dev@example.com");
  assert.equal(validateAdminPathSegment(" org-1 ", "Organization ID"), "org-1");
  assert.deepEqual(requests, []);
});

test("admin reads preserve authentication failures without retry", async () => {
  for (const status of [401, 403]) {
    const failure = createApiError(status, {
      message: "Admin access required",
      meta: { requestId: "req-1" },
    });
    const { client, requests } = fixtureClient(() => {
      throw failure;
    });
    await assert.rejects(
      fetchAdminWorkspaceMembers(client, "hackathon"),
      (error) => error === failure,
    );
    assert.equal(requests.length, 1);
  }
});

test("admin member creation posts only the existing user ID and member role", async () => {
  const { client, requests } = fixtureClient(() => ({ data: member() }));
  const result = await addAdminWorkspaceMember(client, "hackathon", "org-1", {
    id: "user-1",
    email: "DEV@example.com",
  });
  assert.equal(result.id, "member-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.path, "/v1/admin/organizations/hackathon/members");
  assert.deepEqual(requests[0]?.body, { userId: "user-1", role: "member" });
});

test("admin member creation rejects wrong response identity or role with recovery guidance", async () => {
  for (const data of [
    { ...member(), organizationId: "other-org" },
    { ...member(), role: "admin" },
    { ...member(), user: { ...member().user, id: "other-user" } },
    { ...member(), user: { ...member().user, email: "other@example.com" } },
    { ...member(), seatAssignedAt: "secret-not-a-date" },
    null,
  ]) {
    const { client, requests } = fixtureClient(() => ({ data }));
    await assert.rejects(
      addAdminWorkspaceMember(client, "hackathon", "org-1", {
        id: "user-1",
        email: "dev@example.com",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /may have succeeded; inspect `sokosumi --preprod admin members WORKSPACE_SLUG` before retrying/,
        );
        assert.doesNotMatch(error.message, /secret-not-a-date/);
        return true;
      },
    );
    assert.equal(requests.length, 1);
  }
});

test("admin Seat assignment uses PUT without a body and verifies the member", async () => {
  const { client, requests } = fixtureClient(() => ({
    data: {
      memberId: "member?1",
      seatAssignedAt: "2026-09-27T12:00:00.000Z",
      token: "hidden-secret",
    },
  }));
  assert.deepEqual(
    await assignAdminWorkspaceSeat(client, "hackathon", "member?1"),
    { memberId: "member?1", seatAssignedAt: "2026-09-27T12:00:00.000Z" },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "PUT");
  assert.equal(
    requests[0]?.path,
    "/v1/admin/organizations/hackathon/members/member%3F1/seat",
  );
  assert.equal(requests[0]?.body, undefined);
});

test("admin Seat assignment rejects mismatched identities and invalid timestamps without retry", async () => {
  for (const data of [
    { memberId: "other", seatAssignedAt: "2026-09-27T12:00:00.000Z" },
    { memberId: "member-1", seatAssignedAt: null },
    { memberId: "member-1", seatAssignedAt: "2026-02-30T12:00:00.000Z" },
    { memberId: "member-1", seatAssignedAt: "2026-09-27" },
  ]) {
    const { client, requests } = fixtureClient(() => ({ data }));
    await assert.rejects(
      assignAdminWorkspaceSeat(client, "hackathon", "member-1"),
      /may have succeeded/,
    );
    assert.equal(requests.length, 1);
  }
});

test("admin mutations preserve sanitized Core status and reason for capacity or permission errors", async () => {
  for (const status of [400, 401, 403, 404, 409]) {
    const failure = createApiError(status, {
      message: "Core denied this change",
      token: "hidden-secret",
      meta: { requestId: "req-1" },
    });
    const { client, requests } = fixtureClient(() => {
      throw failure;
    });
    await assert.rejects(
      assignAdminWorkspaceSeat(client, "hackathon", "member-1"),
      (error: unknown) => {
        assert.ok(
          error instanceof Error && "status" in error && "body" in error,
        );
        assert.equal(error.status, status);
        assert.equal(error.message, failure.message);
        assert.match(error.message, /Core denied this change/);
        assert.doesNotMatch(error.message, /may have succeeded|hidden-secret/);
        assert.deepEqual(error.body, {
          message: "Core denied this change",
          token: "[REDACTED]",
          meta: { requestId: "req-1" },
        });
        return true;
      },
    );
    assert.equal(requests.length, 1);
  }
});

test("admin mutations report uncertain transport and server failures without retry", async () => {
  for (const failure of [
    new Error("network failure token=hidden-secret"),
    createApiError(503, { message: "Core unavailable" }),
  ]) {
    const { client, requests } = fixtureClient(() => {
      throw failure;
    });
    await assert.rejects(
      addAdminWorkspaceMember(client, "hackathon", "org-1", {
        id: "user-1",
        email: "dev@example.com",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /may have succeeded/);
        assert.doesNotMatch(error.message, /hidden-secret/);
        return true;
      },
    );
    assert.equal(requests.length, 1);
  }
});
