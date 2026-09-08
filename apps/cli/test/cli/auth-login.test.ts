import assert from "node:assert/strict";
import test from "node:test";

import type { OAuthCredentials } from "../../src/auth/auth-manager.js";
import type { BrowserLoginOptions } from "../../src/auth/oauth.js";
import {
  type AuthLoginManager,
  runAuthLogin,
} from "../../src/cli/auth-login.js";

test("auth login stores OAuth credentials without printing the access token", async () => {
  let loginRequest: BrowserLoginOptions | undefined;
  let savedCredentials: OAuthCredentials | undefined;
  const output: string[] = [];
  const loginFn = async (
    request: BrowserLoginOptions,
  ): Promise<OAuthCredentials> => {
    loginRequest = request;
    return {
      authToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      tokenType: "Bearer",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  };
  const authManager: AuthLoginManager = {
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
    authMethod: "oauth",
    apiKeyAvailable: false,
    target: "custom",
    apiUrl: "https://api.example.test",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.doesNotMatch(
    output.join(""),
    /secret-access-token|secret-refresh-token/,
  );
});

test("auth login uses the first-party Sokosumi CLI client when env is unset", async () => {
  let loginRequest: BrowserLoginOptions | undefined;
  const loginFn = async (
    request: BrowserLoginOptions,
  ): Promise<OAuthCredentials> => {
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
    stdout: { write: () => undefined },
  });

  assert.equal(loginRequest?.clientId, "sokosumi_cli");
  assert.equal(loginRequest?.authBaseUrl, "https://api.example.test/auth");
});

test("auth login accepts a target-coded user API key from stdin", async () => {
  const output: string[] = [];
  let savedApiKey: string | undefined;
  const result = await runAuthLogin({
    env: {},
    apiKeyStdin: true,
    readStdin: () => "soko_preprod_secret\n",
    config: {
      target: "preprod",
      apiUrl: "https://api.preprod.sokosumi.com",
      authBaseUrl: "https://api.preprod.sokosumi.com/auth",
      clientId: "preprod-client",
      clientSecret: "",
    },
    targetExplicit: true,
    authManager: {
      saveCredentials: () => {
        throw new Error("OAuth should not run");
      },
      saveApiKey: (credentials) => {
        savedApiKey = credentials.apiKey;
      },
    },
    stdout: { write: (value) => output.push(value) },
    json: true,
  });

  assert.equal(savedApiKey, "soko_preprod_secret");
  assert.deepEqual(result, {
    authenticated: true,
    authMethod: "api-key",
    apiKeyAvailable: true,
    target: "preprod",
    apiUrl: "https://api.preprod.sokosumi.com",
    expiresAt: null,
  });
  assert.deepEqual(JSON.parse(output.join("")), result);
  assert.doesNotMatch(output.join(""), /soko_preprod_secret/);
});

test("target-coded stdin keys select preprod without bearer probing", async () => {
  let savedTarget: string | undefined;
  const result = await runAuthLogin({
    env: {},
    apiKeyStdin: true,
    readStdin: () => "soko_preprod_secret\n",
    authManager: {
      saveCredentials: () => {
        throw new Error("OAuth should not run");
      },
      saveApiKey: (credentials) => {
        savedTarget = credentials.target;
      },
    },
    stdout: { write: () => undefined },
  });

  assert.equal(savedTarget, "preprod");
  assert.equal(result.target, "preprod");
  assert.equal(result.apiUrl, "https://api.preprod.sokosumi.com");
});

test("legacy API keys require an explicit target", async () => {
  await assert.rejects(
    runAuthLogin({
      env: {},
      apiKey: "legacy-secret",
      authManager: {
        saveCredentials: () => {
          throw new Error("OAuth should not run");
        },
        saveApiKey: () => {},
      },
      stdout: { write: () => undefined },
    }),
    /explicit target/,
  );
});

test("auth login rejects API keys containing whitespace", async () => {
  await assert.rejects(
    runAuthLogin({
      env: {},
      apiKey: "soko_mainnet_secret with-space",
      targetExplicit: true,
      authManager: {
        saveCredentials: () => {
          throw new Error("OAuth should not run");
        },
        saveApiKey: () => {},
      },
      stdout: { write: () => undefined },
    }),
    /must not contain whitespace/,
  );
});

test("auth login sends the target-scoped mainnet client ID", async () => {
  let loginRequest: BrowserLoginOptions | undefined;
  await runAuthLogin({
    env: {
      SOKOSUMI_API_URL: "https://api.sokosumi.com",
      SOKOSUMI_MAINNET_OAUTH_CLIENT_ID: "mainnet-client",
    },
    loginFn: async (request) => {
      loginRequest = request;
      return {
        authToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
      };
    },
    authManager: {
      saveCredentials: (credentials) => credentials,
    },
    stdout: { write: () => undefined },
  });
  assert.equal(loginRequest?.clientId, "mainnet-client");
});

test("TestV16 hosted OAuth fails before browser launch without a client ID", async () => {
  let browserLaunched = false;
  await assert.rejects(
    runAuthLogin({
      env: { SOKOSUMI_API_URL: "https://api.sokosumi.com" },
      loginFn: async () => {
        browserLaunched = true;
        throw new Error("browser should not launch");
      },
      authManager: {
        saveCredentials: (credentials) => credentials,
      },
      stdout: { write: () => undefined },
    }),
    /SOKOSUMI_MAINNET_OAUTH_CLIENT_ID/,
  );
  assert.equal(browserLaunched, false);
});
