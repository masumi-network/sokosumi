import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthManager,
  type OAuthCredentials,
} from "../../src/auth/auth-manager.js";
import type { BrowserLoginOptions } from "../../src/auth/oauth.js";
import { parseArgv, runCli } from "../../src/cli/index.js";

function createTestAuthManager(): AuthManager {
  return new AuthManager({
    credentialStore: {
      read: () => null,
      write: (_credentials: OAuthCredentials) => {},
      clear: () => {},
    },
    apiKeyStore: {
      read: () => null,
      write: (_credentials) => {},
      clear: () => {},
    },
  });
}

test("dispatches auth login and emits token-free JSON", async () => {
  const output: string[] = [];
  const loginFn = async (
    request: BrowserLoginOptions,
  ): Promise<OAuthCredentials> => {
    assert.deepEqual(request, {
      authBaseUrl: "https://api.example.test/auth",
      clientId: "cli-client",
    });
    return {
      authToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  };
  const result = await runCli(["auth", "login", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
    },
    loginFn,
    authManager: createTestAuthManager(),
    stdout: { write: (value) => output.push(value) },
  });

  assert.deepEqual(result, {
    authenticated: true,
    authMethod: "oauth",
    apiKeyAvailable: false,
    target: "custom",
    apiUrl: "https://api.example.test",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(output.join("")), result);
  assert.doesNotMatch(output.join(""), /access-token|refresh-token/);
});
test("configured API URL wins over target-coded API-key inference", async () => {
  let selectedApiUrl: string | undefined;
  let selectedTarget: string | undefined;
  await runCli([], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_API_KEY: "soko_preprod_secret",
    },
    authManager: createTestAuthManager(),
    tuiFn: async ({ config }) => {
      selectedApiUrl = config?.apiUrl;
      selectedTarget = config?.target;
      return { tui: true };
    },
  });

  assert.equal(selectedApiUrl, "https://api.example.test");
  assert.equal(selectedTarget, "custom");
});

test("resource commands reject mismatched target API keys before Core requests", async () => {
  let requested = false;
  await assert.rejects(
    runCli(["--preprod", "agents", "list", "--json"], {
      env: { SOKOSUMI_API_KEY: "soko_mainnet_secret" },
      authManager: createTestAuthManager(),
      coreClient: {
        get: async <T>() => {
          requested = true;
          return {} as T;
        },
        post: async <T>() => ({}) as T,
        patch: async <T>() => ({}) as T,
        delete: async <T>() => ({}) as T,
      },
      stdout: { write: () => undefined },
    }),
    /API key belongs to mainnet, but the selected target is preprod/,
  );
  assert.equal(requested, false);
});

test("TestV24 preprod auth ignores a hosted mainnet auth URL flag", async () => {
  let loginRequest: BrowserLoginOptions | undefined;
  await runCli(
    [
      "--preprod",
      "auth",
      "login",
      "--auth-url",
      "https://api.sokosumi.com/auth",
    ],
    {
      env: {
        SOKOSUMI_PREPROD_OAUTH_CLIENT_ID: "preprod-client",
      },
      loginFn: async (request) => {
        loginRequest = request;
        return {
          authToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
        };
      },
      authManager: createTestAuthManager(),
      stdout: { write: () => undefined },
    },
  );

  assert.equal(
    loginRequest?.authBaseUrl,
    "https://api.preprod.sokosumi.com/auth",
  );
  assert.equal(loginRequest?.clientId, "preprod-client");
});

test("strips a lone -- so pnpm extra-args work", async () => {
  const output: string[] = [];
  const result = await runCli(["--", "--help"], {
    stdout: { write: (value) => output.push(value) },
  });
  assert.equal(result.help, true);
  assert.match(output.join(""), /sokosumi auth login/);
});

test("parses coworker registration vendor ID", () => {
  const parsed = parseArgv([
    "coworkers",
    "register",
    "--vendor-id",
    "vendor-1",
  ]);
  assert.deepEqual(parsed.options["vendor-id"], "vendor-1");
});

test("parses job input event ID", () => {
  const parsed = parseArgv([
    "jobs",
    "input",
    "job-1",
    "--event-id",
    "event-1",
    "--input-json",
    '{"answer":"yes"}',
  ]);
  assert.equal(parsed.options["event-id"], "event-1");
});

test("empty argv launches the auth-first status TUI", async () => {
  let launched = false;
  await runCli([], {
    authManager: createTestAuthManager(),
    tuiFn: async () => {
      launched = true;
      return { tui: true };
    },
  });
  assert.equal(launched, true);
});

test("auth logout dispatches without launching the TUI", async () => {
  const output: string[] = [];
  const result = await runCli(["auth", "logout", "--json"], {
    tuiFn: async () => {
      throw new Error("TUI should not launch");
    },
    authManager: createTestAuthManager(),
    stdout: { write: (value) => output.push(value) },
  });
  assert.deepEqual(result, { authenticated: false });
  assert.deepEqual(JSON.parse(output.join("")), result);
});

test("auth status returns stable non-secret JSON", async () => {
  const output: string[] = [];
  const result = await runCli(["auth", "status", "--json"], {
    authManager: createTestAuthManager(),
    stdout: { write: (value) => output.push(value) },
  });

  assert.deepEqual(result, {
    authenticated: false,
    authMethod: null,
    apiKeyAvailable: false,
    target: "mainnet",
    apiUrl: "https://api.sokosumi.com",
    expiresAt: null,
  });
  assert.deepEqual(JSON.parse(output.join("")), result);
});

test("dispatches discover JSON without opening a TUI", async () => {
  const output: string[] = [];
  const result = await runCli(["discover", "--json"], {
    env: { SOKOSUMI_API_URL: "https://api.example.test" },
    authManager: createTestAuthManager(),
    coreClient: {
      get: async <T>() => ({ data: [] }) as T,
      post: async <T>() => ({ data: null }) as T,
      patch: async <T>() => ({ data: null }) as T,
      delete: async <T>() => ({ data: null }) as T,
    },
    stdout: { write: (value) => output.push(value) },
    tuiFn: async () => {
      throw new Error("TUI should not launch");
    },
  });
  assert.deepEqual(result, {});
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.environment, "custom");
  assert.ok(parsed.commands.includes("agents list"));
});

test("dispatches agents list through the injected Core client", async () => {
  const output: string[] = [];
  const result = await runCli(["agents", "list", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_AUTH_TOKEN: "token",
    },
    authManager: createTestAuthManager(),
    coreClient: {
      get: async <T>() =>
        ({
          data: [
            {
              id: "agent-1",
              name: "Researcher",
              description: "Finds facts",
              status: "ONLINE",
              tags: [],
            },
          ],
        }) as T,
      post: async <T>() => ({ data: null }) as T,
      patch: async <T>() => ({ data: null }) as T,
      delete: async <T>() => ({ data: null }) as T,
    },
    stdout: { write: (value) => output.push(value) },
  });
  assert.deepEqual(result, {});
  assert.equal(JSON.parse(output.join("")).agents[0].id, "agent-1");
});
