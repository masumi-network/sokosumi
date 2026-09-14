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

test("TestV55 auth login sanitizes the API URL in its JSON result", async () => {
  const output: string[] = [];
  let loginRequest: BrowserLoginOptions | undefined;
  const apiUrl =
    "https://user:password@host/api?api_key=secret&region=west#fragment";
  const authBaseUrl =
    "https://user:password@host/auth?api_key=secret&region=west";
  const result = await runAuthLogin({
    config: {
      target: "custom",
      apiUrl,
      authBaseUrl,
      clientId: "client",
      clientSecret: "",
    },
    loginFn: async (request) => {
      loginRequest = request;
      return { authToken: "access-token" };
    },
    authManager: {
      saveCredentials: (credentials) => credentials,
    },
    stdout: { write: (value) => output.push(value) },
    json: true,
  });

  assert.equal(loginRequest?.authBaseUrl, authBaseUrl);
  assert.equal(result.apiUrl, "https://host/api?region=west");
  assert.deepEqual(JSON.parse(output.join("")), result);
  assert.doesNotMatch(output.join(""), /user|password|secret|fragment/i);
});

test("TestV52 auth login cancels before saving credentials for aborted OAuth signals", async () => {
  for (const abortMode of ["before login", "during login"] as const) {
    const controller = new AbortController();
    if (abortMode === "before login") controller.abort();

    let saveCount = 0;
    const output: string[] = [];
    await assert.rejects(
      runAuthLogin({
        env: {
          SOKOSUMI_API_URL: "https://api.example.test",
          SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
        },
        signal: controller.signal,
        loginFn: async () => {
          if (abortMode === "during login") controller.abort();
          return { authToken: "secret-access-token" };
        },
        authManager: {
          saveCredentials: (credentials) => {
            saveCount += 1;
            return credentials;
          },
        },
        stdout: { write: (value) => output.push(value) },
      }),
      { message: "OAuth login was cancelled" },
    );
    assert.equal(saveCount, 0, `credentials saved ${abortMode}`);
    assert.deepEqual(output, [], `success reported ${abortMode}`);
  }
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

test("auth login rejects target-coded keys for explicit custom targets", async () => {
  let saved = false;
  await assert.rejects(
    runAuthLogin({
      env: {},
      apiKey: "soko_mainnet_secret",
      config: {
        target: "custom",
        apiUrl: "https://api.example.test",
        authBaseUrl: "https://api.example.test/auth",
        clientId: "custom-client",
        clientSecret: "",
      },
      targetExplicit: true,
      authManager: {
        saveCredentials: () => {
          throw new Error("OAuth should not run");
        },
        saveApiKey: () => {
          saved = true;
        },
      },
      stdout: { write: () => undefined },
    }),
    /explicit target is custom/,
  );
  assert.equal(saved, false);
});

test("TestV58 auth login rejects coworker API keys before injected store writes", async () => {
  let saveApiKeyCalls = 0;
  await assert.rejects(
    runAuthLogin({
      env: {},
      apiKey: "coworker_secret",
      config: {
        target: "custom",
        apiUrl: "https://api.example.test",
        authBaseUrl: "https://api.example.test/auth",
        clientId: "custom-client",
        clientSecret: "",
      },
      targetExplicit: true,
      authManager: {
        saveCredentials: () => {
          throw new Error("OAuth should not run");
        },
        saveApiKey: () => {
          saveApiKeyCalls += 1;
        },
      },
      stdout: { write: () => undefined },
    }),
    /Coworker API keys are not supported by the CLI/,
  );
  assert.equal(saveApiKeyCalls, 0);
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

test("hosted mainnet OAuth uses the compiled first-party client without configuration", async () => {
  let loginRequest: BrowserLoginOptions | undefined;
  await runAuthLogin({
    env: { SOKOSUMI_API_URL: "https://api.sokosumi.com" },
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
  assert.equal(loginRequest?.clientId, "GxmewjdHVAaqUEglxWdyCqVFvnTASycj");
  assert.equal(loginRequest?.authBaseUrl, "https://api.sokosumi.com/auth");
});

test("hosted preprod OAuth uses the compiled first-party client without configuration", async () => {
  let loginRequest: BrowserLoginOptions | undefined;
  await runAuthLogin({
    env: { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com" },
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
  assert.equal(loginRequest?.clientId, "lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR");
  assert.equal(
    loginRequest?.authBaseUrl,
    "https://api.preprod.sokosumi.com/auth",
  );
});
