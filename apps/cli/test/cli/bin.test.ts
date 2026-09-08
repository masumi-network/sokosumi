import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint, main } from "../../bin/sokosumi.js";
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

test("treats a PATH symlink as a direct entrypoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-bin-"));
  const linkPath = join(dir, "sokosumi.ts");
  symlinkSync(binPath, linkPath);
  assert.equal(isDirectEntrypoint(linkPath, import.meta.url), false);
  assert.equal(isDirectEntrypoint(linkPath), true);
});

test("PATH symlink still prints --version", () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-bin-"));
  const linkPath = join(dir, "sokosumi.ts");
  symlinkSync(binPath, linkPath);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", linkPath, "--version"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.1.0");
});
