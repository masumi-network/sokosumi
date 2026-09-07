import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../../src/cli/index.mjs";

test("dispatches auth login and emits token-free JSON", async () => {
  const output = [];
  const loginFn = async (request) => {
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
  const authManager = {
    saveCredentials: (credentials) => credentials,
  };

  const result = await runCli(["auth", "login", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
    },
    loginFn,
    authManager,
    stdout: { write: (value) => output.push(value) },
  });

  assert.deepEqual(result, {
    authenticated: true,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(output.join("")), result);
  assert.doesNotMatch(output.join(""), /access-token|refresh-token/);
});

test("strips a lone -- so pnpm extra-args work", async () => {
  const output = [];
  const result = await runCli(["--", "--help"], {
    stdout: { write: (value) => output.push(value) },
  });
  assert.equal(result.help, true);
  assert.match(output.join(""), /sokosumi auth login/);
});

test("empty argv launches the thin status TUI", async () => {
  let launched = false;
  await runCli([], {
    tuiFn: async () => {
      launched = true;
      return { tui: true };
    },
  });
  assert.equal(launched, true);
});

test("auth logout dispatches without launching the TUI", async () => {
  const output = [];
  const result = await runCli(["auth", "logout", "--json"], {
    tuiFn: async () => {
      throw new Error("TUI should not launch");
    },
    authManager: { logout() {} },
    stdout: { write: (value) => output.push(value) },
  });
  assert.deepEqual(result, { authenticated: false });
  assert.deepEqual(JSON.parse(output.join("")), result);
});
