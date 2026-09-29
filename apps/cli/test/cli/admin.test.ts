import assert from "node:assert/strict";
import test from "node:test";
import { createApiError } from "../../src/api/http-client.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

const member = {
  id: "member-developer",
  organizationId: "org-hackathon",
  role: "member",
  seatAssignedAt: null as string | null,
  user: {
    id: "user-developer",
    email: "developer@example.com",
    name: "Developer",
  },
};

function page(data: unknown[]) {
  return {
    data,
    meta: {
      pagination: {
        cursor: null,
        limit: 50,
        total: data.length,
        nextCursor: null,
      },
    },
  };
}

function fixture({
  role = "user,admin",
  plan = "pro",
  available = 1,
  members = [] as (typeof member)[],
} = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const output: string[] = [];
  const deps: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "fixture-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    stdout: { write: (value) => output.push(value) },
    coreClient: {
      get: async <T>(path: string) => {
        calls.push({ method: "GET", path });
        if (path === "/v1/users/me")
          return {
            data: { id: "organizer", email: "organizer@example.com", role },
          } as T;
        if (path === "/v1/admin/organizations/hackathon")
          return {
            data: {
              organization: {
                id: "org-hackathon",
                name: "Hackathon",
                slug: "hackathon",
                stripeCustomerId: "private-customer",
              },
              billingPlan: {
                mode: "self_serve",
                plan,
                purchasedSeats: plan === "free" ? 0 : 2,
              },
              seatSummary: {
                purchasedSeats: plan === "free" ? 0 : 2,
                assignedCount: plan === "free" ? 0 : 2 - available,
                unusedSeats: plan === "free" ? 0 : available,
                memberCount: members.length,
              },
              totalCredits: 999,
              metadata: { token: "must-not-leak" },
            },
          } as T;
        const url = new URL(path, "https://fixture.invalid");
        assert.equal(url.searchParams.get("limit"), "50");
        if (url.pathname === "/v1/admin/organizations/hackathon/members")
          return page(members) as T;
        if (url.pathname === "/v1/admin/users") {
          assert.equal(url.searchParams.get("query"), "developer@example.com");
          return page([member.user]) as T;
        }
        throw new Error(`Unexpected GET ${path}`);
      },
      post: async <T>(path: string, body: unknown) => {
        calls.push({ method: "POST", path, body });
        assert.equal(path, "/v1/admin/organizations/hackathon/members");
        return { data: member } as T;
      },
      put: async <T>(path: string, body: unknown) => {
        calls.push({ method: "PUT", path, body });
        assert.equal(
          path,
          "/v1/admin/organizations/hackathon/members/member-developer/seat",
        );
        return {
          data: {
            memberId: member.id,
            seatAssignedAt: "2026-09-27T12:00:00.000Z",
          },
        } as T;
      },
      patch: async () => {
        throw new Error("Unexpected PATCH");
      },
    },
  };
  return {
    deps,
    calls,
    output,
    result: () => {
      assert.equal(output.length, 1);
      return JSON.parse(output[0]!);
    },
  };
}

const args = (command: string) => [
  "admin",
  command,
  "hackathon",
  "--email",
  "developer@example.com",
  "--json",
];

// SPEC V42, V90, V98: authenticate on Preprod; Core owns platform authority.
test("admin commands require authentication before any Core request", async () => {
  for (const command of ["members", "add-member", "assign-seat"]) {
    const f = fixture();
    f.deps.env = {};
    await assert.rejects(
      runCli(
        command === "members"
          ? ["admin", command, "hackathon", "--json"]
          : args(command),
        f.deps,
      ),
      /Authentication required/,
    );
    assert.deepEqual(f.calls, []);
    assert.match(f.result().error, /Authentication required/);
  }
});

test("admin onboarding rejects other targets before OAuth refresh", async () => {
  for (const apiUrl of [
    "https://api.sokosumi.com",
    "https://custom.example.com",
  ]) {
    const f = fixture();
    let refreshes = 0;
    f.deps.env = {};
    f.deps.authManager = new AuthManager({
      credentialStore: {
        read: () => ({
          authToken: "expired",
          refreshToken: "fixture-refresh",
          expiresAt: "2000-01-01T00:00:00.000Z",
        }),
        write() {},
        clear() {},
      },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
      refreshTokenFn: async () => {
        refreshes++;
        throw new Error("Unexpected refresh");
      },
    });
    await assert.rejects(
      runCli([...args("add-member"), "--api-url", apiUrl], f.deps),
      /Preprod only/,
    );
    assert.equal(refreshes, 0);
    assert.deepEqual(f.calls, []);
    assert.match(f.result().error, /Preprod only/);
  }
});

test("admin command inputs fail locally before identity lookup", async () => {
  for (const argv of [
    ["admin"],
    ["admin", "unknown", "hackathon"],
    ["admin", "members"],
    ["admin", "members", ".."],
    ["admin", "add-member", "hackathon"],
    ["admin", "add-member", "hackathon", "--email", "not-an-email"],
    ["admin", "members", "hackathon", "--email", "developer@example.com"],
    [
      "admin",
      "add-member",
      "hackathon",
      "--email",
      "developer@example.com",
      "--create-api-key",
    ],
    ["admin", "members", "hackathon", "extra"],
  ]) {
    const f = fixture();
    await assert.rejects(runCli([...argv, "--json"], f.deps));
    assert.deepEqual(f.calls, [], argv.join(" "));
    assert.equal(typeof f.result().error, "string");
  }
});

test("non-admin roles cannot call admin APIs or change members", async () => {
  for (const role of [
    "user",
    "superadmin",
    "organization-admin",
    "user,developer",
  ]) {
    const f = fixture({ role });
    await assert.rejects(
      runCli(args("add-member"), f.deps),
      /requires a Sokosumi platform admin/,
    );
    assert.deepEqual(f.calls, [{ method: "GET", path: "/v1/users/me" }]);
    assert.match(f.result().error, /platform admin/);
  }
});

test("admin member listing returns only Workspace and member fields", async () => {
  const f = fixture({ role: " user, ADMIN ", members: [member] });
  await runCli(["admin", "members", "hackathon", "--json"], f.deps);
  const result = f.result();
  assert.equal(result.workspace.id, member.organizationId);
  assert.equal(result.workspace.seatSummary.unusedSeats, 1);
  assert.equal(result.members[0].taskSeatEligible, false);
  assert.equal(result.members[0].user.email, member.user.email);
  assert.ok(f.calls.every((call) => call.method === "GET"));
  assert.doesNotMatch(
    f.output.join(""),
    /stripeCustomerId|private-customer|totalCredits|must-not-leak/,
  );
});

test("admin adds the exact existing developer as an ordinary member only", async () => {
  const f = fixture();
  await runCli(args("add-member"), f.deps);
  assert.deepEqual(
    f.calls.filter((call) => call.method !== "GET"),
    [
      {
        method: "POST",
        path: "/v1/admin/organizations/hackathon/members",
        body: { userId: member.user.id, role: "member" },
      },
    ],
  );
  assert.equal(f.result().created, true);
  assert.equal(f.result().taskSeatEligible, false);
  assert.equal(f.result().organizationId, member.organizationId);
  assert.equal(f.result().member.id, member.id);
});

test("existing membership is returned without changing its role", async () => {
  const f = fixture({ members: [{ ...member, role: "admin" }] });
  await runCli(args("add-member"), f.deps);
  assert.equal(f.result().created, false);
  assert.equal(f.result().member.role, "admin");
  assert.ok(f.calls.every((call) => call.method === "GET"));
  assert.ok(f.calls.every((call) => !call.path.startsWith("/v1/admin/users?")));
});

test("free members pass Seat policy without a Seat mutation", async () => {
  for (const command of ["add-member", "assign-seat"]) {
    const f = fixture({ plan: "free", available: 0, members: [member] });
    await runCli(args(command), f.deps);
    assert.equal(f.result().taskSeatEligible, true);
    if (command === "assign-seat")
      assert.equal(f.result().seatAssignment, "not-required");
    assert.ok(f.calls.every((call) => call.method === "GET"));
  }
});

test("admin assigns one available Seat with a bodyless PUT", async () => {
  const f = fixture({ members: [member] });
  await runCli(args("assign-seat"), f.deps);
  assert.deepEqual(
    f.calls.filter((call) => call.method !== "GET"),
    [
      {
        method: "PUT",
        path: "/v1/admin/organizations/hackathon/members/member-developer/seat",
        body: undefined,
      },
    ],
  );
  assert.equal(f.result().seatAssignment, "assigned");
  assert.equal(f.result().taskSeatEligible, true);
  assert.equal(f.result().member.seatAssignedAt, "2026-09-27T12:00:00.000Z");
});

test("existing Seat is a read-only success even at full capacity", async () => {
  const f = fixture({
    available: 0,
    members: [{ ...member, seatAssignedAt: "2026-09-26T12:00:00.000Z" }],
  });
  await runCli(args("assign-seat"), f.deps);
  assert.equal(f.result().seatAssignment, "existing");
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("full Seat capacity never buys capacity or changes another member", async () => {
  const f = fixture({ available: 0, members: [member] });
  await assert.rejects(runCli(args("assign-seat"), f.deps), /No unused Seats/);
  assert.ok(f.calls.every((call) => call.method === "GET"));
  assert.match(f.result().error, /Web billing/);
});

test("Seat assignment requires existing unambiguous membership", async () => {
  for (const members of [[], [member, { ...member, id: "duplicate-member" }]]) {
    const f = fixture({ members });
    await assert.rejects(
      runCli(args("assign-seat"), f.deps),
      /not a member|Multiple Workspace members/,
    );
    assert.ok(f.calls.every((call) => call.method === "GET"));
  }
});

test("members from another organization fail before any mutation", async () => {
  const f = fixture({ members: [{ ...member, organizationId: "other-org" }] });
  await assert.rejects(
    runCli(args("assign-seat"), f.deps),
    /different organization/,
  );
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("Core rejection after admin preflight stays a single JSON error without retry", async () => {
  const f = fixture();
  let writes = 0;
  f.deps.coreClient!.post = async () => {
    writes++;
    throw createApiError(403, {
      message: "Admin access required",
      details: { token: "must-not-leak" },
    });
  };
  await assert.rejects(runCli(args("add-member"), f.deps), /403/);
  assert.equal(writes, 1);
  assert.match(f.result().error, /Admin access required/);
  assert.doesNotMatch(f.output.join(""), /must-not-leak/);
});
