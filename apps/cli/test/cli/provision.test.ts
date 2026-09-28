import assert from "node:assert/strict";
import test from "node:test";
import { createApiError } from "../../src/api/http-client.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

function dependencies(): CliDependencies {
  return {
    env: { SOKOSUMI_AUTH_TOKEN: "test-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    coreClient: {
      get: async () => {
        throw new Error("Unexpected GET");
      },
      post: async () => {
        throw new Error("Unexpected POST");
      },
      patch: async () => {
        throw new Error("Unexpected PATCH");
      },
    },
    stdout: { write() {} },
  };
}

const args = [
  "coworkers",
  "provision",
  "--vendor-id",
  "developer-vendor",
  "--name",
  "Ada's Agent",
  "--capability",
  "tasks",
];

// V90, V91, V98: Preprod only; Core controls creation; developer manages the record.
test("admin provisions through CLI without Vendor or Workspace membership", async () => {
  for (const json of [false, true]) {
    const deps = dependencies();
    const calls: { path: string; body: unknown }[] = [];
    const output: string[] = [];
    deps.stdout = { write: (value) => output.push(value) };
    deps.coreClient!.post = async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      return {
        data: { id: "cw-ada", name: "Ada's Agent", isWhitelisted: false },
      } as T;
    };
    await runCli([...args, ...(json ? ["--json"] : [])], deps);
    assert.deepEqual(calls, [
      {
        path: "/v1/coworkers",
        body: {
          vendorId: "developer-vendor",
          name: "Ada's Agent",
          capabilities: ["tasks"],
        },
      },
    ]);
    if (json) {
      const result = JSON.parse(output.join(""));
      assert.equal(result.coworker.id, "cw-ada");
      assert.equal(result.coworker.isWhitelisted, false);
      assert.equal(result.apiKey, undefined);
      assert.equal(result.workspaceAccess, undefined);
    } else {
      assert.match(output.join(""), /Give Coworker ID cw-ada to the developer/);
      assert.match(
        output.join(""),
        /coworkers connect cw-ada --vendor-id developer-vendor/,
      );
      assert.match(output.join(""), /coworkers api-key cw-ada --json/);
    }
  }
});

test("provision rejects Mainnet before any Core request", async () => {
  await assert.rejects(
    runCli([...args, "--api-url", "https://api.sokosumi.com"], dependencies()),
    /Preprod only/,
  );
});

test("Coworker setup rejects Mainnet before refreshing expired OAuth credentials", async () => {
  for (const command of ["provision", "register", "connect"]) {
    const deps = dependencies();
    const refreshBases: string[] = [];
    let writes = 0;
    deps.env = {};
    deps.authManager = new AuthManager({
      environment: {},
      credentialStore: {
        read: () => ({
          authToken: "expired-token",
          refreshToken: "test-refresh",
          expiresAt: "2000-01-01T00:00:00.000Z",
        }),
        write: () => {
          writes++;
        },
        clear() {},
      },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
      refreshTokenFn: async ({ authBaseUrl }) => {
        refreshBases.push(authBaseUrl);
        return {
          authToken: "refreshed-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        };
      },
    });
    await assert.rejects(
      runCli(
        ["coworkers", command, "--api-url", "https://api.sokosumi.com"],
        deps,
      ),
      /Preprod only/,
    );
    assert.deepEqual(refreshBases, [], command);
    assert.equal(writes, 0, command);
  }
});

test("provision reports uncertain creation when Core returns no ID", async () => {
  const deps = dependencies();
  let creates = 0;
  deps.coreClient!.post = async <T>() => {
    creates++;
    return { data: {} } as T;
  };
  await assert.rejects(
    runCli(args, deps),
    /Creation may have succeeded.*before retrying/,
  );
  assert.equal(creates, 1);
});

test("provision explains the developer handoff after Core denies creation", async () => {
  const deps = dependencies();
  let creates = 0;
  deps.coreClient!.post = async (path: string) => {
    assert.equal(path, "/v1/coworkers");
    creates++;
    throw createApiError(403, { error: "Admin access required" });
  };
  await assert.rejects(runCli(args, deps), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /platform admin/);
    assert.match(error.message, /developer-vendor/);
    assert.match(error.message, /organizer/);
    assert.match(error.message, /coworkers connect/);
    assert.match(error.message, /coworkers api-key/);
    return true;
  });
  assert.equal(creates, 1);
});

test("provision validates handoff inputs before creating a record", async () => {
  for (const [argv, message] of [
    [
      ["coworkers", "provision", "--name", "Agent"],
      /vendor id is required.*provision/,
    ],
    [
      ["coworkers", "provision", "--vendor-id", "developer-vendor"],
      /name is required/,
    ],
    [[...args, "--workspace-id", "org-1"], /coworkers connect/],
    [[...args, "--create-api-key"], /coworkers api-key/],
  ] as const) {
    await assert.rejects(runCli([...argv], dependencies()), message);
  }
});
