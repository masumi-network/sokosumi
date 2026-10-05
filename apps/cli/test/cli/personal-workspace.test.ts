import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type CoreHttpClient,
  createApiError,
} from "../../src/api/http-client.js";
import { ensurePersonalWorkspace } from "../../src/api/services/personal-workspace-service.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";
import { startRuntimeTask } from "../../src/coworker/runtime-task.js";

const workspaceId = "11111111-1111-7111-8111-111111111111";
const runtimeKey = "coworker_personal_fixture";
function fixture() {
  let exists = false;
  let status = "READY";
  let mappedOrganization: string | null = null;
  let mappingStatus = 200;
  const reads: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const output: string[] = [];
  const task = () => ({
    id: "task-1",
    name: "Greeting",
    description: "Say hello",
    ownerId: "self-user",
    organizationId: null,
    workspace: { id: workspaceId, organizationId: null },
    assigneeId: "cw-1",
    status,
  });
  const coreClient: CoreHttpClient = {
    get: async <T>(path: string) => {
      reads.push(path);
      if (path === "/v1/users/me")
        return {
          data: { id: "self-user", email: "self@example.com", role: "user" },
        } as T;
      if (path === "/v1/users/me/workspace-access")
        return { data: { hasPersonalWorkspace: exists } } as T;
      if (path === "/v1/vendors/me")
        return { data: [{ id: "vendor-1", role: "admin" }] } as T;
      if (path === "/v1/coworkers/cw-1")
        return { data: { id: "cw-1", vendor: { id: "vendor-1" } } } as T;
      if (path === `/v1/workspaces/${workspaceId}`)
        return { data: { organizationId: mappedOrganization } } as T;
      if (path.includes("/tasks/task-1/")) return { data: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    post: async <T>(path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === "/v1/users/me/personal-workspace") {
        exists = true;
        return { data: { workspaceId } } as T;
      }
      if (path === "/v1/coworkers")
        return {
          data: {
            id: "cw-1",
            name: "Agent",
            isWhitelisted: false,
            vendor: { id: "vendor-1" },
          },
        } as T;
      if (path.endsWith("/workspace-access"))
        return {
          data: {
            id: "access-1",
            coworkerId: "cw-1",
            workspaceId,
            status: "GRANTED",
          },
        } as T;
      if (path === "/v1/tasks") return { data: task() } as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    patch: async () => {
      throw new Error("Unexpected PATCH");
    },
    put: async () => {
      throw new Error("Unexpected PUT");
    },
  };
  const dependencies: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "developer_fixture" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    coreClient,
    stdout: {
      write(value) {
        output.push(value);
      },
    },
    runtime: {
      credentialStore: {
        isSupported: true,
        read: () => ({ apiKey: runtimeKey }),
        write() {},
        clear() {},
      },
      preflight: async () => {},
      execute: async () => "Hello",
      fetchImpl: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Authorization"), `Bearer ${runtimeKey}`);
        assert.equal(headers.get("X-Organization-Slug"), null);
        assert.equal(headers.get("X-Context-Organization-Id"), null);
        if (path === "/v1/coworkers/me")
          return Response.json({
            data: { id: "cw-1", archivedAt: null, capabilities: ["tasks"] },
          });
        if (path === "/v1/tasks/task-1" && init?.method === "GET")
          return Response.json({ data: task() });
        if (path === `/v1/workspaces/${workspaceId}`) {
          assert.equal(headers.get("X-Context-User-Id"), "self-user");
          return Response.json(
            { data: { organizationId: mappedOrganization } },
            { status: mappingStatus },
          );
        }
        if (path === "/v1/tasks/task-1/events") {
          assert.equal(headers.get("X-Context-User-Id"), null);
          const body = JSON.parse(String(init?.body));
          status = body.status;
          posts.push({ path, body });
          return Response.json({
            data: {
              id: "event-1",
              taskId: "task-1",
              status,
              actor: { type: "coworker", id: "cw-1" },
            },
          });
        }
        throw new Error(`Unexpected runtime ${path}`);
      },
    },
  };
  const invoke = (args: string[]) => {
    output.length = 0;
    return runCli([...args, "--preprod", "--json"], dependencies);
  };
  return {
    coreClient,
    reads,
    posts,
    output,
    invoke,
    setExists(value: boolean) {
      exists = value;
    },
    setMapping(org: string | null, code = 200) {
      mappedOrganization = org;
      mappingStatus = code;
    },
  };
}

// V99, V100: personal setup and Core ownership, Coworker-only runtime.
test("V99/V100 personal registration, Task creation, start, and completion", async () => {
  const f = fixture();
  await f.invoke(["workspaces", "list", "--personal"]);
  assert.deepEqual(JSON.parse(f.output.join("")), {
    hasPersonalWorkspace: false,
  });
  assert.equal(f.posts.length, 0);
  await f.invoke([
    "coworkers",
    "register",
    "--personal",
    "--vendor-id",
    "vendor-1",
    "--name",
    "Agent",
    "--capability",
    "tasks",
  ]);
  assert.equal(
    JSON.parse(f.output.join("")).workspaceAccess.workspaceId,
    workspaceId,
  );
  assert.deepEqual(
    f.posts.map((p) => p.path),
    [
      "/v1/users/me/personal-workspace",
      "/v1/coworkers",
      "/v1/coworkers/cw-1/workspace-access",
    ],
  );
  assert.deepEqual(f.posts[2].body, { userId: "self-user" });
  await f.invoke([
    "coworkers",
    "connect",
    "cw-1",
    "--personal",
    "--vendor-id",
    "vendor-1",
  ]);
  assert.equal(f.posts.filter((p) => p.path === "/v1/coworkers").length, 1);
  assert.equal(
    f.posts.filter((p) => p.path.includes("personal-workspace")).length,
    1,
  );
  await f.invoke([
    "tasks",
    "create",
    "--personal",
    "--coworker-id",
    "cw-1",
    "--description",
    "Say hello",
    "--status",
    "READY",
  ]);
  await f.invoke([
    "runtime",
    "start",
    "task-1",
    "--personal",
    "--coworker-id",
    "cw-1",
  ]);
  const file = join(
    mkdtempSync(join(tmpdir(), "personal-result-")),
    "result.txt",
  );
  writeFileSync(file, "Hello");
  await f.invoke([
    "runtime",
    "complete",
    "task-1",
    "--personal",
    "--coworker-id",
    "cw-1",
    "--result-file",
    file,
  ]);
  assert.equal(JSON.parse(f.output.join("")).status, "COMPLETED");
  assert.doesNotMatch(
    f.output.join(""),
    /developer_fixture|coworker_personal_fixture/,
  );
});

for (const args of [
  [
    "coworkers",
    "register",
    "--personal",
    "--workspace-id",
    "org-1",
    "--vendor-id",
    "vendor-1",
    "--name",
    "Agent",
  ],
  [
    "tasks",
    "create",
    "--personal",
    "--organization-slug",
    "org",
    "--coworker-id",
    "cw-1",
    "--description",
    "Hello",
  ],
  [
    "runtime",
    "start",
    "task-1",
    "--personal",
    "--organization-id",
    "org-1",
    "--coworker-id",
    "cw-1",
  ],
])
  test(`V99 rejects mixed personal selector: ${args[0]}`, async () => {
    const f = fixture();
    await assert.rejects(f.invoke(args), /cannot be combined/);
    assert.equal(f.posts.length, 0);
    assert.equal(f.reads.length, 0);
  });
for (const [org, code] of [
  ["foreign-org", 200],
  [null, 403],
] as const)
  test(`V100 runtime blocks unauthorized or organization Workspace (${code})`, async () => {
    const f = fixture();
    f.setMapping(org, code);
    await assert.rejects(
      f.invoke([
        "runtime",
        "start",
        "task-1",
        "--personal",
        "--coworker-id",
        "cw-1",
      ]),
    );
    assert.equal(f.posts.length, 0);
  });
test("personal runtime run uses the same authorized Workspace check", async () => {
  const f = fixture();
  await f.invoke([
    "runtime",
    "run",
    "task-1",
    "--personal",
    "--coworker-id",
    "cw-1",
    "--hermes-home",
    "/tmp/hermes",
    "--runtime-directory",
    "/tmp/runtime",
  ]);
  assert.equal(JSON.parse(f.output.join("")).status, "COMPLETED");
});
test("personal Workspace create handles only a verified concurrent creation", async () => {
  const f = fixture();
  f.coreClient.post = async () => {
    f.setExists(true);
    throw createApiError(409, { message: "Personal workspace already exists" });
  };
  await ensurePersonalWorkspace(f.coreClient);
  assert.deepEqual(f.reads, [
    "/v1/users/me/workspace-access",
    "/v1/users/me/workspace-access",
  ]);
});
test("personal Task creation stops when no personal Workspace exists", async () => {
  const f = fixture();
  await assert.rejects(
    f.invoke([
      "tasks",
      "create",
      "--personal",
      "--coworker-id",
      "cw-1",
      "--description",
      "Hello",
    ]),
    /Personal Workspace is missing/,
  );
  assert.equal(f.posts.length, 0);
});

// V92/V99/V103: recovery preserves the created identity and error classification.
for (const failure of [
  "workspace unavailable",
  "workspace denied",
  "network failure",
  "different Coworker",
] as const)
  test(`V92 personal registration preserves recovery after ${failure}`, async () => {
    const f = fixture();
    f.setExists(true);
    const get = f.coreClient.get;
    const post = f.coreClient.post;
    f.coreClient.get = async <T>(path: string) => {
      if (path === `/v1/workspaces/${workspaceId}`) {
        if (failure === "workspace unavailable")
          throw createApiError(503, { message: "Service unavailable" });
        if (failure === "workspace denied")
          throw createApiError(403, { message: "Access denied" });
        if (failure === "network failure") throw new TypeError("fetch failed");
      }
      return get<T>(path);
    };
    f.coreClient.post = async <T>(path: string, body: unknown) => {
      if (
        failure === "different Coworker" &&
        path.endsWith("/workspace-access")
      ) {
        await post(path, body);
        return {
          data: {
            id: "access-1",
            coworkerId: "different-coworker",
            workspaceId,
            status: "GRANTED",
          },
        } as T;
      }
      return post<T>(path, body);
    };
    await assert.rejects(
      f.invoke([
        "coworkers",
        "register",
        "--personal",
        "--vendor-id",
        "vendor-1",
        "--name",
        "Agent",
        "--create-api-key",
      ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Coworker cw-1 was created/);
        assert.match(error.message, /Do not register again/);
        assert.match(
          error.message,
          /coworkers connect cw-1 --vendor-id vendor-1 --personal --preprod/,
        );
        return true;
      },
    );
    assert.deepEqual(
      f.posts.map(({ path }) => path),
      ["/v1/coworkers", "/v1/coworkers/cw-1/workspace-access"],
    );
    const payload = JSON.parse(f.output.join(""));
    assert.match(payload.error, /cw-1/);
    const expected = {
      "workspace unavailable": { code: "API_ERROR", status: 503 },
      "workspace denied": { code: "PERMISSION_DENIED", status: 403 },
      "network failure": { code: "NETWORK", status: undefined },
      "different Coworker": { code: "UNKNOWN", status: undefined },
    }[failure];
    assert.equal(payload.code, expected.code);
    assert.equal(payload.status, expected.status);
  });
// V101: fixed allowlisted recovery text; raw Core body stays private.
for (const kind of [
  "grant_required",
  "grant_denied",
  "grant_revoked",
  "unknown_kind",
  "__proto__",
  "constructor",
])
  test(`V101 runtime safely reports ${kind}`, async () => {
    const secret = "token=must_not_appear";
    const client: CoreHttpClient = {
      get: async () => {
        throw createApiError(403, { kind, message: secret, detail: secret });
      },
      post: async () => {
        throw new Error("Unexpected POST");
      },
      patch: async () => {
        throw new Error("Unexpected PATCH");
      },
      put: async () => {
        throw new Error("Unexpected PUT");
      },
    };
    await assert.rejects(
      startRuntimeTask({
        client,
        coworkerId: "cw-1",
        organizationId: "org-1",
        taskId: "task-1",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 403/);
        assert.doesNotMatch(error.message, /must_not_appear|token=/);
        if (kind.startsWith("grant_"))
          assert.match(error.message, new RegExp(kind));
        else assert.doesNotMatch(error.message, new RegExp(kind));
        return true;
      },
    );
  });

// V102: raw Core Task DTO retains owner and Workspace fields omitted by parseTask.
test("V102 personal Task mismatch preserves its created ID for recovery", async () => {
  const f = fixture();
  f.setExists(true);
  f.coreClient.post = async <T>() =>
    ({
      data: {
        id: "created-task-id",
        ownerId: "foreign-user",
        organizationId: "foreign-org",
        workspace: { id: workspaceId, organizationId: "foreign-org" },
      },
    }) as T;
  await assert.rejects(
    f.invoke([
      "tasks",
      "create",
      "--personal",
      "--coworker-id",
      "cw-1",
      "--description",
      "Hello",
    ]),
    /created-task-id.*Inspect this Task before retrying/,
  );
});

for (const kind of [
  "grant_required",
  "grant_denied",
  "grant_revoked",
  "unknown_kind",
])
  test(`V101 personal authorization callback safely reports ${kind}`, async () => {
    let events = 0;
    const client: CoreHttpClient = {
      get: async <T>(path: string) =>
        ({
          data:
            path === "/v1/coworkers/me"
              ? { id: "cw-1", archivedAt: null, capabilities: ["tasks"] }
              : {
                  id: "task-1",
                  assigneeId: "cw-1",
                  ownerId: "self-user",
                  organizationId: null,
                  workspace: { id: workspaceId, organizationId: null },
                  name: "Task",
                  description: null,
                  status: "READY",
                },
        }) as T,
      post: async () => {
        events++;
        throw new Error("Unexpected event");
      },
      patch: async () => {
        throw new Error("Unexpected PATCH");
      },
      put: async () => {
        throw new Error("Unexpected PUT");
      },
    };
    await assert.rejects(
      startRuntimeTask({
        client,
        coworkerId: "cw-1",
        organizationId: null,
        taskId: "task-1",
        authorizePersonalWorkspace: async (owner, id) => {
          assert.equal(owner, "self-user");
          assert.equal(id, workspaceId);
          throw createApiError(403, {
            kind,
            message: "UNTRUSTED_SERVER_MESSAGE",
            detail: "UNTRUSTED_SERVER_MESSAGE",
          });
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /UNTRUSTED_SERVER_MESSAGE/);
        if (kind.startsWith("grant_"))
          assert.match(error.message, new RegExp(kind));
        else assert.doesNotMatch(error.message, /unknown_kind/);
        return true;
      },
    );
    assert.equal(events, 0);
  });
