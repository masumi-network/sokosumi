import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint, main } from "../../bin/sokosumi.js";
import packageJson from "../../package.json" with { type: "json" };
import {
  AuthManager,
  type OAuthCredentials,
} from "../../src/auth/auth-manager.js";
import type { BrowserLoginOptions } from "../../src/auth/oauth.js";

const binPath = fileURLToPath(
  new URL("../../bin/sokosumi.ts", import.meta.url),
);

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

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

async function withInteractiveTTY<T>(
  callback: () => Promise<T>,
  { stdin = true, stdout = true }: { stdin?: boolean; stdout?: boolean } = {},
): Promise<T> {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: stdin,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: stdout,
  });
  try {
    return await callback();
  } finally {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinIsTTY,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalStdoutIsTTY,
    });
  }
}

test("runs auth login through the public binary entrypoint", async () => {
  const output: string[] = [];
  const loginFn = async (
    _request: BrowserLoginOptions,
  ): Promise<OAuthCredentials> => ({
    authToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  const result = await main(["auth", "login", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
    },
    loginFn,
    authManager: createTestAuthManager(),
    stdout: { write: (value: string) => output.push(value) },
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
});
test("headless auth errors emit one redacted JSON document", async () => {
  const secret = "bearer-secret-token";
  const output: string[] = [];
  const authManager = createTestAuthManager();
  authManager.getAuthTokenAsync = async () => {
    throw new Error(`Authorization Bearer ${secret}`);
  };

  await assert.rejects(
    () =>
      main(["agents", "list", "--json"], {
        env: {
          SOKOSUMI_API_URL: "https://api.example.test",
          SOKOSUMI_AUTH_TOKEN: secret,
        },
        authManager,
        stdout: { write: (value: string) => output.push(value) },
      }),
    /Authorization Bearer bearer-secret-token/,
  );

  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    error: "Authorization Bearer [REDACTED]",
  });
  assert.equal(output.join("").includes(secret), false);
});

test("direct JSON headless errors do not add a stderr copy", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", binPath, "not-a-command", "--json"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    error:
      "Usage: sokosumi discover | agents list | coworkers | tasks | jobs | auth login|status|logout",
  });
  assert.equal(result.stderr, "");
});

test("treats a PATH symlink as a direct entrypoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-bin-"));
  const linkPath = join(dir, "sokosumi.ts");
  symlinkSync(binPath, linkPath);
  assert.equal(isDirectEntrypoint(linkPath, import.meta.url), false);
  assert.equal(isDirectEntrypoint(linkPath), true);
});

test("V35: PATH symlink prints package manifest --version", () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-bin-"));
  const linkPath = join(dir, "sokosumi.ts");
  symlinkSync(binPath, linkPath);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", linkPath, "--version"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("interactive global update prevents the old TUI from launching", async () => {
  const output: string[] = [];
  let npmCommand: string | undefined;
  let npmArgs: readonly string[] | undefined;
  let launched = false;

  await withInteractiveTTY(async () => {
    const result = await main([], {
      stdout: { write: (value: string) => output.push(value) },
      updateCheck: {
        isGlobalInstall: () => true,
        fetch: async () =>
          ({
            ok: true,
            json: async () => ({ version: "2.1.4" }),
          }) as Response,
        prompt: async () => "y",
        npmExec: async (command, args) => {
          npmCommand = command;
          npmArgs = args;
        },
      },
      tuiFn: async () => {
        launched = true;
        return { tui: true };
      },
    });

    assert.deepEqual(result, {});
  });

  assert.equal(launched, false);
  assert.equal(npmCommand, npmExecutable);
  assert.deepEqual(npmArgs, [
    "install",
    "--global",
    "--ignore-scripts",
    "sokosumi@2.1.4",
  ]);
  assert.match(output.join(""), /updated to v2\.1\.4.*restart/i);
});

test("non-TTY no-argument execution skips update fetch and launches the TUI", async () => {
  let fetchCalls = 0;
  let launched = false;

  const result = await withInteractiveTTY(
    () =>
      main([], {
        authManager: createTestAuthManager(),
        updateCheck: {
          isGlobalInstall: () => true,
          fetch: async () => {
            fetchCalls += 1;
            return {
              ok: true,
              json: async () => ({ version: "2.1.4" }),
            } as Response;
          },
        },
        tuiFn: async () => {
          launched = true;
          return { tui: true };
        },
      }),
    { stdin: false, stdout: true },
  );

  assert.deepEqual(result, { tui: true });
  assert.equal(fetchCalls, 0);
  assert.equal(launched, true);
});

test("declined interactive update launches the TUI", async () => {
  let prompted = false;
  let launched = false;

  const result = await withInteractiveTTY(async () =>
    main([], {
      authManager: createTestAuthManager(),
      updateCheck: {
        isGlobalInstall: () => true,
        fetch: async () =>
          ({
            ok: true,
            json: async () => ({ version: "2.1.4" }),
          }) as Response,
        prompt: async () => {
          prompted = true;
          return "n";
        },
      },
      tuiFn: async () => {
        launched = true;
        return { tui: true };
      },
    }),
  );

  assert.deepEqual(result, { tui: true });
  assert.equal(prompted, true);
  assert.equal(launched, true);
});

test("update failure launches the TUI without restart output", async () => {
  const output: string[] = [];
  let npmCommand: string | undefined;
  let npmArgs: readonly string[] | undefined;
  let launched = false;

  const result = await withInteractiveTTY(async () =>
    main([], {
      authManager: createTestAuthManager(),
      stdout: { write: (value: string) => output.push(value) },
      updateCheck: {
        isGlobalInstall: () => true,
        fetch: async () =>
          ({
            ok: true,
            json: async () => ({ version: "2.1.4" }),
          }) as Response,
        prompt: async () => "y",
        npmExec: async (command, args) => {
          npmCommand = command;
          npmArgs = args;
          throw new Error("npm unavailable");
        },
      },
      tuiFn: async () => {
        launched = true;
        return { tui: true };
      },
    }),
  );

  assert.deepEqual(result, { tui: true });
  assert.equal(launched, true);
  assert.equal(npmCommand, npmExecutable);
  assert.deepEqual(npmArgs, [
    "install",
    "--global",
    "--ignore-scripts",
    "sokosumi@2.1.4",
  ]);
  assert.equal(output.join(""), "");
});

test("entrypoint update checks only the no-argument interactive path", async () => {
  let fetchCalls = 0;
  const updateCheck = {
    isGlobalInstall: () => true,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({ version: "2.1.4" }),
      } as Response;
    },
    prompt: async () => "N",
    npmExec: async () => {},
  };

  await withInteractiveTTY(async () => {
    await main(["auth", "status", "--json"], {
      updateCheck,
      authManager: createTestAuthManager(),
      stdout: { write: () => undefined },
    });
    await main(["--help"], { updateCheck, stdout: { write: () => undefined } });
    await main(["--version"], {
      updateCheck,
      stdout: { write: () => undefined },
    });
  });

  assert.equal(fetchCalls, 0);
});
