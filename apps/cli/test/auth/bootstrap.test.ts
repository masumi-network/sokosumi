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
