import assert from "node:assert/strict";
import test from "node:test";
import { createApiError } from "../../src/api/http-client.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

function dependencies(role = "user,admin"): CliDependencies {
  return {
    env: { SOKOSUMI_AUTH_TOKEN: "test-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    coreClient: {
      get: async <T>(path: string) => {
        assert.equal(path, "/v1/users/me");
        return {
          data: { id: "user-admin", email: "admin@example.com", role },
        } as T;
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
  for (const role of ["admin", "user,admin", " user, ADMIN "]) {
    for (const json of [false, true]) {
      const deps = dependencies(role);
      const calls: { path: string; body: unknown }[] = [];
      const reads: string[] = [];
      const output: string[] = [];
      const get = deps.coreClient!.get;
      deps.coreClient!.get = async <T>(path: string, signal?: AbortSignal) => {
        reads.push(path);
        assert.equal(calls.length, 0);
        return get<T>(path, signal);
      };
      deps.stdout = { write: (value) => output.push(value) };
      deps.coreClient!.post = async <T>(path: string, body: unknown) => {
        calls.push({ path, body });
        return {
          data: {
            id: "cw-ada",
            name: "Ada's Agent",
            isWhitelisted: false,
            vendor: { id: "developer-vendor" },
          },
        } as T;
      };
      await runCli([...args, ...(json ? ["--json"] : [])], deps);
      assert.deepEqual(reads, ["/v1/users/me"]);
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
        assert.equal(output.length, 1);
        const result = JSON.parse(output.join(""));
        assert.equal(result.coworker.id, "cw-ada");
        assert.equal(result.coworker.isWhitelisted, false);
        assert.equal(result.apiKey, undefined);
        assert.equal(result.workspaceAccess, undefined);
        assert.deepEqual(result.handoff, {
          coworkerId: "cw-ada",
          vendorId: "developer-vendor",
        });
        assert.deepEqual(Object.keys(result), ["coworker", "handoff"]);
      } else {
        assert.match(output.join(""), /Admin step complete/);
        assert.match(
          output.join(""),
          /Give Coworker ID cw-ada and Vendor ID developer-vendor to the developer/,
        );
        assert.match(
          output.join(""),
          /coworkers connect cw-ada --vendor-id developer-vendor/,
        );
        assert.match(output.join(""), /coworkers api-key cw-ada --json/);
        const nextCommands = [
          "auth whoami --json",
          "workspaces list",
          "coworkers connect cw-ada",
          "coworkers api-key cw-ada --json",
        ];
        let previous = -1;
        for (const command of nextCommands) {
          const position = output.join("").indexOf(command);
          assert.ok(position > previous, command);
          previous = position;
        }
        assert.match(
          output.join(""),
          /Operator: create the runtime key in a trusted terminal/,
        );
      }
    }
  }
});

test("provision rejects non-admin identities without creating or switching accounts", async () => {
  for (const role of [
    "user",
    "superadmin",
    "user,superadmin",
    "administrator",
  ]) {
    const deps = dependencies(role);
    let creates = 0;
    deps.coreClient!.post = async () => {
      creates++;
      throw new Error("Unexpected creation");
    };
    await assert.rejects(runCli(args, deps), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /admin@example.com \[user-admin\]/);
      assert.ok(error.message.includes(`platform role: ${role}.`));
      assert.match(error.message, /platform admin/);
      assert.match(error.message, /Vendor developer-vendor.*organizer/);
      assert.match(error.message, /auth whoami --json/);
      return true;
    });
    assert.equal(creates, 0);
  }
});

test("provision rejects malformed identity fields before creation", async () => {
  for (const identity of [
    null,
    {},
    { id: "", email: "admin@example.com", role: "admin" },
    { id: "user-admin", email: null, role: "admin" },
    { id: "user-admin", email: "admin@example.com" },
    { id: "user-admin", email: "admin@example.com", role: ["admin"] },
    { id: "user-admin", email: "admin@example.com", role: "admin\n" },
  ]) {
    const deps = dependencies();
    let creates = 0;
    deps.coreClient!.get = async <T>() => ({ data: identity }) as T;
    deps.coreClient!.post = async () => {
      creates++;
      throw new Error("Unexpected creation");
    };
    await assert.rejects(runCli(args, deps), /Invalid user identity response/);
    assert.equal(creates, 0);
  }
});

test("provision stops after failed identity verification without retrying or creating", async () => {
  for (const failure of [
    createApiError(401, { message: "token=must-not-appear" }),
    createApiError(403, { message: "token=must-not-appear" }),
    new Error("token=must-not-appear"),
  ]) {
    const deps = dependencies();
    let reads = 0;
    let creates = 0;
    const output: string[] = [];
    deps.stdout = { write: (value) => output.push(value) };
    deps.coreClient!.get = async () => {
      reads++;
      throw failure;
    };
    deps.coreClient!.post = async () => {
      creates++;
      throw new Error("Unexpected creation");
    };
    await assert.rejects(
      runCli([...args, "--json"], deps),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Could not verify the signed-in account/);
        assert.doesNotMatch(error.message, /must-not-appear/);
        if ("status" in failure && failure.status === 401)
          assert.match(error.message, /status 401.*Sign in again/);
        return true;
      },
    );
    assert.equal(reads, 1);
    assert.equal(creates, 0);
    assert.equal(output.length, 1);
    assert.equal(typeof JSON.parse(output[0]!).error, "string");
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

test("provision preserves the created ID when the returned Vendor is missing or different", async () => {
  for (const vendor of [undefined, null, { id: "other-vendor" }]) {
    const deps = dependencies();
    let creates = 0;
    const output: string[] = [];
    deps.stdout = { write: (value) => output.push(value) };
    deps.coreClient!.post = async <T>() => {
      creates++;
      return { data: { id: "cw-ada", vendor, isWhitelisted: false } } as T;
    };
    await assert.rejects(
      runCli([...args, "--json"], deps),
      /Coworker cw-ada.*Vendor does not match developer-vendor.*Creation may have succeeded.*before retrying/,
    );
    assert.equal(creates, 1);
    assert.equal(output.length, 1);
    assert.equal(JSON.parse(output[0]!).handoff, undefined);
  }
});

test("provision reports uncertain creation when the Vendor parser rejects the response", async () => {
  const deps = dependencies();
  let creates = 0;
  deps.coreClient!.post = async <T>() => {
    creates++;
    return { data: { id: "cw-ada", vendor: {}, isWhitelisted: false } } as T;
  };
  await assert.rejects(
    runCli(args, deps),
    /invalid Coworker Vendor.*Creation may have succeeded.*before retrying/,
  );
  assert.equal(creates, 1);
});

test("provision confirms the raw whitelist field before reporting private creation", async () => {
  for (const isWhitelisted of [undefined, null, true, "false", 0]) {
    const deps = dependencies();
    let creates = 0;
    deps.coreClient!.post = async <T>() => {
      creates++;
      return {
        data: {
          id: "cw-ada",
          vendor: { id: "developer-vendor" },
          isWhitelisted,
        },
      } as T;
    };
    await assert.rejects(
      runCli(args, deps),
      /Coworker cw-ada.*private approval state could not be confirmed.*Creation may have succeeded.*before retrying/,
    );
    assert.equal(creates, 1);
  }
});

test("provision explains the developer handoff after Core denies creation", async () => {
  const deps = dependencies();
  let creates = 0;
  deps.coreClient!.post = async (path: string) => {
    assert.equal(path, "/v1/coworkers");
    creates++;
    throw createApiError(403, {
      error: "Forbidden",
      message: "Admin access required",
    });
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

test("provision JSON retains the Core reason and request ID without exposing credentials", async () => {
  const deps = dependencies();
  const output: string[] = [];
  deps.stdout = { write: (value) => output.push(value) };
  const failure = createApiError(403, {
    error: "Forbidden",
    message: "Organization membership required",
    meta: { requestId: "request-provision" },
    details: { accessToken: "must-not-appear" },
  });
  deps.coreClient!.post = async () => {
    throw failure;
  };
  await assert.rejects(
    runCli([...args, "--json"], deps),
    (error) => error === failure,
  );
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]!);
  assert.match(result.error, /status 403/);
  assert.match(result.error, /Organization membership required/);
  assert.match(result.error, /request-provision/);
  assert.match(result.error, /auth whoami --json/);
  assert.doesNotMatch(result.error, /platform admin|must-not-appear/);
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
    [[...args, "--name", "  "], /name is required/],
    [[...args, "--vendor-id", "  "], /vendor id is required/],
  ] as const) {
    const deps = dependencies();
    let reads = 0;
    deps.coreClient!.get = async () => {
      reads++;
      throw new Error("Unexpected identity read");
    };
    await assert.rejects(runCli([...argv], deps), message);
    assert.equal(reads, 0);
  }
});
