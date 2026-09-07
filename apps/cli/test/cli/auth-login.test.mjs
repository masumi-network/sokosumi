import assert from "node:assert/strict";
import test from "node:test";

import { runAuthLogin } from "../../src/cli/auth-login.mjs";

test("auth login stores OAuth credentials without printing the access token", async () => {
  let loginRequest;
  let savedCredentials;
  const output = [];
  const loginFn = async (request) => {
    loginRequest = request;
    return {
      authToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      tokenType: "Bearer",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  };
  const authManager = {
    saveCredentials: (credentials) => {
      savedCredentials = credentials;
      return credentials;
    },
  };

  const result = await runAuthLogin({
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
      SOKOSUMI_OAUTH_CLIENT_SECRET: "client-secret",
    },
    loginFn,
    authManager,
    stdout: { write: (value) => output.push(value) },
  });

  assert.deepEqual(loginRequest, {
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    clientSecret: "client-secret",
  });
  assert.deepEqual(savedCredentials, {
    authToken: "secret-access-token",
    refreshToken: "secret-refresh-token",
    tokenType: "Bearer",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(result, {
    authenticated: true,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.doesNotMatch(
    output.join(""),
    /secret-access-token|secret-refresh-token/,
  );
});

test("auth login uses the first-party Sokosumi CLI client when env is unset", async () => {
  let loginRequest;
  const loginFn = async (request) => {
    loginRequest = request;
    return {
      authToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      tokenType: "Bearer",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  };

  await runAuthLogin({
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
    },
    loginFn,
    authManager: {
      saveCredentials: (credentials) => credentials,
    },
    stdout: { write: () => {} },
  });

  assert.equal(loginRequest.clientId, "sokosumi_cli");
  assert.equal(loginRequest.authBaseUrl, "https://api.example.test/auth");
});
