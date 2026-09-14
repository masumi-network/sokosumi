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

test("V38: no-argument source run opens the TUI directly", async () => {
  let launched = false;
  const result = await main([], {
    authManager: createTestAuthManager(),
    tuiFn: async () => {
      launched = true;
      return { tui: true };
    },
  });

  assert.deepEqual(result, { tui: true });
  assert.equal(launched, true);
});

test("V42: no-argument JSON errors emit one redacted document", async () => {
  const secret = "tui-bearer-secret";
  const output: string[] = [];

  await assert.rejects(
    () =>
      main(["--json"], {
        env: { SOKOSUMI_AUTH_TOKEN: secret },
        stdout: { write: (value: string) => output.push(value) },
        tuiFn: async () => {
          throw new Error(`Authorization Bearer ${secret}`);
        },
      }),
    /Authorization Bearer tui-bearer-secret/,
  );

  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    error: "Authorization Bearer [REDACTED]",
  });
  assert.equal(output.join("").includes(secret), false);
});
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
test("TestV47 direct text errors redact credential assignments", () => {
  const secret = "redaction_probe";
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      binPath,
      "auth",
      "status",
      "ignored",
      `apiKey=${secret}`,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Unexpected argument: apiKey: [REDACTED]\n");
  assert.equal(result.stderr.includes(secret), false);
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
