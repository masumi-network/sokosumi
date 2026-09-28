import assert from "node:assert/strict";
import test from "node:test";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

function fixture() {
  const output: string[] = [];
  const deps: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "fixture-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    stdout: { write: (value) => output.push(value) },
  };
  return { deps, output };
}

// Core organization middleware authorizes X-Organization-Slug for user credentials.
test("Task creation and detail reads carry the selected organization on Preprod", async (t) => {
  const f = fixture();
  const calls: { path: string; method: string; slug: string | null }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.preprod.sokosumi.com");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer fixture-token");
      calls.push({
        path: url.pathname,
        method: init?.method ?? "GET",
        slug: headers.get("X-Organization-Slug"),
      });
      return Response.json({
        data:
          url.pathname === "/v1/tasks"
            ? { id: "task-1", organizationId: "org-1", status: "READY" }
            : [],
      });
    },
  );
  await runCli(
    [
      "--preprod",
      "tasks",
      "create",
      "--organization-slug",
      " pilot_team-1 ",
      "--coworker-id",
      "coworker-1",
      "--description",
      "Test Task",
      "--status",
      "READY",
      "--json",
    ],
    f.deps,
  );
  assert.deepEqual(calls, [
    { path: "/v1/tasks", method: "POST", slug: "pilot_team-1" },
    { path: "/v1/tasks/task-1/events", method: "GET", slug: "pilot_team-1" },
    { path: "/v1/tasks/task-1/jobs", method: "GET", slug: "pilot_team-1" },
  ]);
  assert.equal(f.output.length, 1);
  assert.equal(JSON.parse(f.output[0]!).task.organizationId, "org-1");
});

test("Task Workspace selection preserves the selected target and applies to every Task command", async (t) => {
  const f = fixture();
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://fixture.invalid");
      assert.equal(
        new Headers(init?.headers).get("X-Organization-Slug"),
        "pilot-team",
      );
      calls.push(url.pathname);
      return Response.json({
        data: url.pathname === "/v1/tasks/task-1" ? { id: "task-1" } : [],
      });
    },
  );
  for (const args of [
    ["list"],
    ["get", "task-1"],
    ["events", "task-1"],
    ["jobs", "task-1"],
    ["comment", "task-1", "--comment", "hello"],
  ]) {
    await runCli(
      [
        "--api-url",
        "https://fixture.invalid",
        "tasks",
        ...args,
        "--organization-slug",
        "pilot-team",
        "--json",
      ],
      f.deps,
    );
  }
  assert.equal(f.output.length, 5);
  assert.ok(calls.includes("/v1/tasks"));
  assert.ok(calls.includes("/v1/tasks/task-1/events"));
  assert.ok(calls.includes("/v1/tasks/task-1/jobs"));
});

test("Task commands without a Workspace flag keep the credential context", async (t) => {
  const f = fixture();
  let requests = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      requests++;
      assert.equal(new Headers(init?.headers).get("X-Organization-Slug"), null);
      return Response.json({ data: [] });
    },
  );
  await runCli(["--preprod", "tasks", "list", "--json"], f.deps);
  assert.equal(requests, 1);
});

test("invalid Workspace slugs and non-Task use fail before authentication", async (t) => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected fetch");
  });
  for (const args of [
    ...[" ", "..", "team/name", "team name", "team\n", "team\u200b"].map(
      (slug) => ["tasks", "list", "--organization-slug", slug],
    ),
    ...[
      ["auth", "login"],
      ["admin", "members", "pilot"],
      ["coworkers", "list"],
      ["jobs", "list"],
      [],
    ].map((command) => [...command, "--organization-slug", "pilot"]),
  ]) {
    const f = fixture();
    f.deps.env = {};
    f.deps.authManager = new AuthManager({
      credentialStore: {
        read: () => {
          reads++;
          return null;
        },
        write() {},
        clear() {},
      },
      apiKeyStore: {
        read: () => {
          reads++;
          return null;
        },
        write() {},
        clear() {},
      },
    });
    reads = 0;
    await assert.rejects(
      runCli([...args, "--json"], f.deps),
      /Organization slug|only supported by tasks/,
    );
    assert.equal(f.output.length, 1);
    assert.equal(typeof JSON.parse(f.output[0]!).error, "string");
    assert.equal(reads, 0);
  }
});

// SPEC V67, V42: a selected Workspace must not silently become personal context.
test("Task commands reject ID selectors before auth or HTTP, including mixed selectors", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("Unexpected fetch");
  });
  for (const command of [
    ["create", "--coworker-id", "coworker-1", "--description", "Test Task"],
    ["list"],
    ["get", "task-1"],
    ["events", "task-1"],
    ["jobs", "task-1"],
    ["comment", "task-1", "--comment", "hello"],
  ]) {
    for (const selector of ["--organization-id", "--workspace-id"]) {
      for (const includeSlug of [false, true]) {
        const f = fixture();
        let reads = 0;
        let writes = 0;
        let refreshes = 0;
        f.deps.env = {};
        f.deps.authManager = new AuthManager({
          credentialStore: {
            read: () => {
              reads++;
              return {
                authToken: "expired-fixture-token",
                refreshToken: "fixture-refresh",
                expiresAt: "2000-01-01T00:00:00.000Z",
              };
            },
            write: () => {
              writes++;
            },
            clear: () => {
              writes++;
            },
          },
          apiKeyStore: {
            read: () => {
              reads++;
              return null;
            },
            write: () => {
              writes++;
            },
            clear: () => {
              writes++;
            },
          },
          refreshTokenFn: async () => {
            refreshes++;
            throw new Error("Unexpected refresh");
          },
        });
        reads = 0;
        writes = 0;
        const argv = [
          "--preprod",
          "tasks",
          ...command,
          selector,
          "expected-org",
          ...(includeSlug ? ["--organization-slug", "pilot"] : []),
          "--json",
        ];
        await assert.rejects(runCli(argv, f.deps), {
          message:
            "Task commands do not accept --organization-id or --workspace-id. Use --organization-slug WORKSPACE_SLUG.",
        });
        assert.equal(f.output.length, 1, argv.join(" "));
        assert.match(
          JSON.parse(f.output[0]!).error,
          /Use --organization-slug WORKSPACE_SLUG/,
        );
        assert.equal(reads, 0);
        assert.equal(writes, 0);
        assert.equal(refreshes, 0);
        assert.equal(requests, 0);
      }
    }
  }
});

test("Core Workspace denial is returned once without falling back to personal context", async (t) => {
  const f = fixture();
  let requests = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      requests++;
      assert.equal(
        new Headers(init?.headers).get("X-Organization-Slug"),
        "pilot",
      );
      return Response.json(
        { error: "Organization membership required" },
        { status: 403 },
      );
    },
  );
  await assert.rejects(
    runCli(
      ["--preprod", "tasks", "list", "--organization-slug", "pilot", "--json"],
      f.deps,
    ),
    /403.*Organization membership required/,
  );
  assert.equal(requests, 1);
  assert.equal(f.output.length, 1);
  assert.match(
    JSON.parse(f.output[0]!).error,
    /Organization membership required/,
  );
});
