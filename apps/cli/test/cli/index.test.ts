import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
const binPath = fileURLToPath(
  new URL("../../bin/sokosumi.ts", import.meta.url),
);

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
    tuiFn: async () => {
      throw new Error("TUI should not launch");
    },
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
test("TestV43 configured API URL wins over target-coded API-key inference", async () => {
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

test("TestV42 preflight rejects unauthenticated resource commands before Core", async () => {
  let coreCalls = 0;
  const output: string[] = [];
  const errorMessage =
    "Authentication required. Run `sokosumi auth login` first.";
  await assert.rejects(
    runCli(["agents", "list", "--json"], {
      env: { SOKOSUMI_API_URL: "https://api.example.test" },
      authManager: createTestAuthManager(),
      coreClient: {
        get: async <T>() => {
          coreCalls += 1;
          return {} as T;
        },
        post: async <T>() => {
          coreCalls += 1;
          return {} as T;
        },
        patch: async <T>() => {
          coreCalls += 1;
          return {} as T;
        },
        delete: async <T>() => {
          coreCalls += 1;
          return {} as T;
        },
      },
      stdout: { write: (value) => output.push(value) },
    }),
    new RegExp(errorMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(coreCalls, 0);
  assert.equal(output.join(""), `${JSON.stringify({ error: errorMessage })}\n`);
  assert.deepEqual(JSON.parse(output.join("")), { error: errorMessage });
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
test("parses value options inline before and after positionals", () => {
  const expected = {
    positionals: ["agents", "list"],
    options: { name: "Researcher" },
  };

  assert.deepEqual(
    parseArgv(["--name=Researcher", "agents", "list"]),
    expected,
  );
  assert.deepEqual(
    parseArgv(["--name", "Researcher", "agents", "list"]),
    expected,
  );
  assert.deepEqual(
    parseArgv(["agents", "list", "--name=Researcher"]),
    expected,
  );
  assert.deepEqual(
    parseArgv(["agents", "list", "--name", "Researcher"]),
    expected,
  );
});

test("rejects missing and empty value options", () => {
  for (const argv of [["--name"], ["--name="], ["--name", ""]]) {
    assert.throws(() => parseArgv(argv), /Option --name requires a value/);
  }
});

test("rejects inline values for boolean options without echoing them", async () => {
  const secret = "boolean-inline-secret";
  const output: string[] = [];
  await assert.rejects(
    runCli([`--details=${secret}`, "--json"], {
      stdout: { write: (value) => output.push(value) },
    }),
    /Option --details does not accept a value/,
  );
  assert.deepEqual(JSON.parse(output.join("")), {
    error: "Option --details does not accept a value",
  });
  assert.equal(output.join("").includes(secret), false);
});

test("TestV49 unsupported inline option values are never echoed", async () => {
  const secret = "soko_mainnet_secret";
  const output: string[] = [];
  await assert.rejects(
    runCli([`--api-key=${secret}`, "--json"], {
      stdout: { write: (value) => output.push(value) },
    }),
    /Unknown option: --api-key$/,
  );
  assert.equal(
    output.join(""),
    `${JSON.stringify({ error: "Unknown option: --api-key" })}\n`,
  );
  assert.equal(output.join("").includes(secret), false);
});

test("TestV47 index JSON errors redact credential assignments", async () => {
  const apiKey = "index-api-key";
  const refreshToken = "index-refresh-token";
  const output: string[] = [];
  const message = `Core API failed: apiKey=${apiKey} refreshToken=${refreshToken} ordinary detail`;
  await assert.rejects(
    runCli(["agents", "list", "--json"], {
      env: { SOKOSUMI_AUTH_TOKEN: "auth-token" },
      authManager: createTestAuthManager(),
      coreClient: {
        get: async <_T>() => {
          throw new Error(message);
        },
        post: async <T>() => ({}) as T,
        patch: async <T>() => ({}) as T,
        delete: async <T>() => ({}) as T,
      },
      stdout: { write: (value) => output.push(value) },
    }),
    new RegExp(message),
  );

  assert.equal(output.length, 1);
  const serialized = output[0];
  assert.doesNotMatch(serialized, new RegExp(apiKey));
  assert.doesNotMatch(serialized, new RegExp(refreshToken));
  assert.deepEqual(JSON.parse(serialized), {
    error:
      "Core API failed: apiKey: [REDACTED] refreshToken: [REDACTED] ordinary detail",
  });
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

test("TestV19 auth status rejected promises emit one redacted JSON error", async () => {
  const secret = "status-secret-token";
  const output: string[] = [];
  const authManager = createTestAuthManager();
  authManager.getAuthTokenAsync = async () => {
    throw new Error(`Authorization Bearer ${secret}`);
  };

  await assert.rejects(
    runCli(["auth", "status", "--json"], {
      env: { SOKOSUMI_AUTH_TOKEN: secret },
      authManager,
      stdout: { write: (value) => output.push(value) },
    }),
    /Authorization Bearer status-secret-token/,
  );

  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    error: "Authorization Bearer [REDACTED]",
  });
  assert.equal(output[0].includes(secret), false);
});

test("TestV59 malformed HOME config emits one redacted JSON error", () => {
  const secret = "home-secret-token";
  const home = mkdtempSync(join(tmpdir(), `${secret}-`));
  const configPath = join(home, ".sokosumi", "config.json");
  mkdirSync(join(home, ".sokosumi"));
  writeFileSync(configPath, "{", "utf8");

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", binPath, "auth", "status", "--json"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        SOKOSUMI_AUTH_TOKEN: secret,
      },
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.split(/\r?\n/u).filter(Boolean).length, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    error: `Could not parse CLI config file: ${configPath.replaceAll(
      secret,
      "[REDACTED]",
    )}`,
  });
  assert.equal(result.stdout.includes(secret), false);
});

test("TestV44 auth status accepts an untagged key with --preprod", async () => {
  const output: string[] = [];
  const result = await runCli(["--preprod", "auth", "status", "--json"], {
    env: { SOKOSUMI_API_KEY: "legacy-api-key" },
    authManager: createTestAuthManager(),
    stdout: { write: (value) => output.push(value) },
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.authMethod, "api-key");
  assert.equal(result.target, "preprod");
  assert.equal(result.apiKeyAvailable, true);
  assert.deepEqual(JSON.parse(output.join("")), result);
});

test("TestV44 auth status accepts an untagged key with --api-url", async () => {
  const output: string[] = [];
  const result = await runCli(
    ["--api-url", "https://api.example.test", "auth", "status", "--json"],
    {
      env: { SOKOSUMI_API_KEY: "legacy-api-key" },
      authManager: createTestAuthManager(),
      stdout: { write: (value) => output.push(value) },
    },
  );

  assert.equal(result.authenticated, true);
  assert.equal(result.authMethod, "api-key");
  assert.equal(result.target, "custom");
  assert.equal(result.apiUrl, "https://api.example.test");
  assert.equal(result.apiKeyAvailable, true);
  assert.deepEqual(JSON.parse(output.join("")), result);
});

test("dispatches discover JSON without opening a TUI", async () => {
  const output: string[] = [];
  const result = await runCli(["discover", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_AUTH_TOKEN: "test-token",
    },
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
