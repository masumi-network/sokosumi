import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint, main } from "../../bin/sokosumi.mjs";

const binPath = fileURLToPath(
  new URL("../../bin/sokosumi.mjs", import.meta.url),
);

test("runs auth login through the public binary entrypoint", async () => {
  const output = [];
  const result = await main(["auth", "login", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
    },
    loginFn: async () => ({
      authToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }),
    authManager: { saveCredentials: (credentials) => credentials },
    stdout: { write: (value) => output.push(value) },
  });

  assert.deepEqual(result, {
    authenticated: true,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(output.join("")), result);
});

test("treats a PATH symlink as a direct entrypoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-bin-"));
  const linkPath = join(dir, "sokosumi");
  symlinkSync(binPath, linkPath);
  assert.equal(isDirectEntrypoint(linkPath, import.meta.url), false);
  assert.equal(isDirectEntrypoint(linkPath), true);
});

test("PATH symlink still prints --version", () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-bin-"));
  const linkPath = join(dir, "sokosumi");
  symlinkSync(binPath, linkPath);
  const result = spawnSync(process.execPath, [linkPath, "--version"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0.1.0");
});
