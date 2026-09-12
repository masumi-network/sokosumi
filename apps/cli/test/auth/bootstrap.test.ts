import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveInitialAuth,
  selectBootRoute,
} from "../../src/auth/bootstrap.js";

test("selectBootRoute waits until auth resolves", () => {
  assert.equal(
    selectBootRoute({ authResolved: false, hasAuth: false }),
    "boot",
  );
  assert.equal(selectBootRoute({ authResolved: false, hasAuth: true }), "boot");
});

test("selectBootRoute shows auth or signed-in after resolve", () => {
  assert.equal(selectBootRoute({ authResolved: true, hasAuth: false }), "auth");
  assert.equal(
    selectBootRoute({ authResolved: true, hasAuth: true }),
    "signed-in",
  );
});

test("resolves API-key status without exposing the key", async () => {
  const result = await resolveInitialAuth({
    authManager: {
      getApiKeyCredentials: () => null,
      getAuthTokenAsync: async () => "soko_mainnet_secret",
      getAuthMethod: () => "api-key",
      getCredentials: () => null,
    },
    config: {
      target: "mainnet",
      apiUrl: "https://api.sokosumi.com",
      authBaseUrl: "https://api.sokosumi.com/auth",
      clientId: "mainnet-client",
      clientSecret: "",
    },
    environment: { SOKOSUMI_API_KEY: "soko_mainnet_secret" },
  });

  assert.deepEqual(result, {
    authenticated: true,
    authMethod: "api-key",
    expiresAt: null,
  });
});

test("rejects a target-coded key for the wrong target", async () => {
  await assert.rejects(
    resolveInitialAuth({
      authManager: {
        getApiKeyCredentials: () => null,
        getAuthTokenAsync: async () => "soko_preprod_secret",
        getAuthMethod: () => "api-key",
        getCredentials: () => null,
      },
      config: {
        target: "mainnet",
        apiUrl: "https://api.sokosumi.com",
        authBaseUrl: "https://api.sokosumi.com/auth",
        clientId: "mainnet-client",
        clientSecret: "",
      },
      environment: { SOKOSUMI_API_KEY: "soko_preprod_secret" },
    }),
    /selected target is mainnet/,
  );
});

test("TestV51 rejects a hosted API key for an explicit custom target", async () => {
  await assert.rejects(
    resolveInitialAuth({
      authManager: {
        getApiKeyCredentials: () => null,
        getAuthTokenAsync: async () => "soko_mainnet_secret",
        getAuthMethod: () => "api-key",
        getCredentials: () => null,
      },
      config: {
        target: "custom",
        apiUrl: "https://api.example.test",
        authBaseUrl: "https://api.example.test/auth",
        clientId: "custom-client",
        clientSecret: "",
      },
      environment: { SOKOSUMI_API_KEY: "soko_mainnet_secret" },
      targetExplicit: true,
    }),
    /explicit target is custom/,
  );
});

test("TestV58 rejects coworker API keys before the auth manager calls Core", async () => {
  let authTokenCalls = 0;
  await assert.rejects(
    resolveInitialAuth({
      authManager: {
        getApiKeyCredentials: () => null,
        getAuthTokenAsync: async () => {
          authTokenCalls += 1;
          return "coworker_secret";
        },
        getAuthMethod: () => "api-key",
        getCredentials: () => null,
      },
      config: {
        target: "custom",
        apiUrl: "https://api.example.test",
        authBaseUrl: "https://api.example.test/auth",
        clientId: "custom-client",
        clientSecret: "",
      },
      environment: { SOKOSUMI_API_KEY: "coworker_secret" },
      targetExplicit: true,
    }),
    /Coworker API keys are not supported by the CLI/,
  );
  assert.equal(authTokenCalls, 0);
});

test("TestV44 rejects an untagged environment API key without an explicit target", async () => {
  await assert.rejects(
    resolveInitialAuth({
      authManager: {
        getApiKeyCredentials: () => null,
        getAuthTokenAsync: async () => "legacy_secret",
        getAuthMethod: () => "api-key",
        getCredentials: () => null,
      },
      config: {
        target: "mainnet",
        apiUrl: "https://api.sokosumi.com",
        authBaseUrl: "https://api.sokosumi.com/auth",
        clientId: "mainnet-client",
        clientSecret: "",
      },
      environment: { SOKOSUMI_API_KEY: "legacy_secret" },
    }),
    /Legacy API keys need an explicit target/,
  );
});

test("TestV44 rejects an untagged stored API key without an explicit target", async () => {
  await assert.rejects(
    resolveInitialAuth({
      authManager: {
        getApiKeyCredentials: () => ({ apiKey: "legacy_secret" }),
        getAuthTokenAsync: async () => "legacy_secret",
        getAuthMethod: () => "api-key",
        getCredentials: () => null,
      },
      config: {
        target: "mainnet",
        apiUrl: "https://api.sokosumi.com",
        authBaseUrl: "https://api.sokosumi.com/auth",
        clientId: "mainnet-client",
        clientSecret: "",
      },
      environment: {},
    }),
    /Legacy API keys need an explicit target/,
  );
});

test("TestV44 accepts an untagged environment API key with an explicit target", async () => {
  const result = await resolveInitialAuth({
    authManager: {
      getApiKeyCredentials: () => null,
      getAuthTokenAsync: async () => "legacy_secret",
      getAuthMethod: () => "api-key",
      getCredentials: () => null,
    },
    config: {
      target: "mainnet",
      apiUrl: "https://api.sokosumi.com",
      authBaseUrl: "https://api.sokosumi.com/auth",
      clientId: "mainnet-client",
      clientSecret: "",
    },
    environment: { SOKOSUMI_API_KEY: "legacy_secret" },
    targetExplicit: true,
  });

  assert.deepEqual(result, {
    authenticated: true,
    authMethod: "api-key",
    expiresAt: null,
  });
});
