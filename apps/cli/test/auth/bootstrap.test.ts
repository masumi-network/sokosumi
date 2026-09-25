import assert from "node:assert/strict";
import test from "node:test";

import { AuthManager } from "../../src/auth/auth-manager.js";
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  bootstrapCliSession,
  createSessionAuthManager,
  requireAuthenticatedSession,
  resolveInitialAuth,
  selectBootRoute,
} from "../../src/auth/bootstrap.js";
import { MAINNET_API_URL, PREPROD_API_URL } from "../../src/auth/config.js";

function memoryAuthManager(): AuthManager {
  return new AuthManager({
    credentialStore: {
      read: () => null,
      write: () => {},
      clear: () => {},
    },
    apiKeyStore: {
      read: () => null,
      write: () => {},
      clear: () => {},
    },
  });
}

const MAINNET_CONFIG = {
  target: "mainnet" as const,
  apiUrl: MAINNET_API_URL,
  authBaseUrl: `${MAINNET_API_URL}/auth`,
  clientId: "mainnet-client",
  clientSecret: "",
};

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

test("rejects a hosted API key for an explicit custom target", async () => {
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

test("rejects coworker API keys before the auth manager calls Core", async () => {
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

test("rejects an untagged environment API key without an explicit target", async () => {
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

test("rejects an untagged stored API key without an explicit target", async () => {
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

test("accepts an untagged environment API key with an explicit target", async () => {
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

test("bootstrapCliSession infers preprod from a target-coded API key", () => {
  const session = bootstrapCliSession({
    environment: { SOKOSUMI_API_KEY: "soko_preprod_secret" },
    loadFiles: false,
    authManager: memoryAuthManager(),
  });
  assert.equal(session.config.target, "preprod");
  assert.equal(session.config.apiUrl, PREPROD_API_URL);
  assert.equal(session.targetExplicit, false);
});

test("Coworker registration can default to Preprod without changing other commands", () => {
  const registration = bootstrapCliSession({
    environment: {},
    loadFiles: false,
    preprodDefault: true,
    authManager: memoryAuthManager(),
  });
  const otherCommand = bootstrapCliSession({
    environment: {},
    loadFiles: false,
    authManager: memoryAuthManager(),
  });

  assert.equal(registration.config.target, "preprod");
  assert.equal(registration.targetExplicit, false);
  assert.equal(otherCommand.config.target, "mainnet");
});

test("explicit network settings override the Coworker Preprod default", () => {
  const apiUrl = bootstrapCliSession({
    environment: { SOKOSUMI_API_URL: MAINNET_API_URL },
    loadFiles: false,
    preprodDefault: true,
    authManager: memoryAuthManager(),
  });
  const apiKey = bootstrapCliSession({
    environment: { SOKOSUMI_API_KEY: "soko_mainnet_secret" },
    loadFiles: false,
    preprodDefault: true,
    authManager: memoryAuthManager(),
  });

  assert.equal(apiUrl.config.target, "mainnet");
  assert.equal(apiKey.config.target, "mainnet");
});

test("bootstrapCliSession keeps an explicit API URL over API-key inference", () => {
  const session = bootstrapCliSession({
    environment: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_API_KEY: "soko_preprod_secret",
    },
    loadFiles: false,
    authManager: memoryAuthManager(),
  });
  assert.equal(session.config.target, "custom");
  assert.equal(session.config.apiUrl, "https://api.example.test");
  assert.equal(session.targetExplicit, true);
});

test("bootstrapCliSession applies preprod and apiUrl the same for TUI and headless", () => {
  const preprod = bootstrapCliSession({
    environment: {},
    loadFiles: false,
    preprod: true,
    authManager: memoryAuthManager(),
  });
  assert.equal(preprod.config.target, "preprod");
  assert.equal(preprod.env.SOKOSUMI_API_URL, PREPROD_API_URL);
  assert.equal(preprod.targetExplicit, true);

  const custom = bootstrapCliSession({
    environment: {},
    loadFiles: false,
    preprod: true,
    apiUrl: "https://api.example.test",
    authManager: memoryAuthManager(),
  });
  assert.equal(custom.config.target, "custom");
  assert.equal(custom.config.apiUrl, "https://api.example.test");
  assert.equal(custom.targetExplicit, true);
});

test("createSessionAuthManager reuses an injected manager", () => {
  const injected = memoryAuthManager();
  let factoryCalls = 0;
  const result = createSessionAuthManager({
    config: MAINNET_CONFIG,
    environment: {},
    authManager: injected,
    authManagerFactory: () => {
      factoryCalls += 1;
      return memoryAuthManager();
    },
  });
  assert.equal(result, injected);
  assert.equal(factoryCalls, 0);
});

test("createSessionAuthManager uses the factory when no manager is injected", () => {
  const created = memoryAuthManager();
  let factoryCalls = 0;
  const result = createSessionAuthManager({
    config: MAINNET_CONFIG,
    environment: {},
    authManagerFactory: (options) => {
      factoryCalls += 1;
      assert.equal(options.targetScope, "mainnet");
      assert.equal(options.clientId, MAINNET_CONFIG.clientId);
      return created;
    },
  });
  assert.equal(result, created);
  assert.equal(factoryCalls, 1);
});

test("requireAuthenticatedSession rejects before Core when unsigned-in", async () => {
  await assert.rejects(
    requireAuthenticatedSession({
      authManager: {
        getApiKeyCredentials: () => null,
        getAuthTokenAsync: async () => null,
        getAuthMethod: () => null,
        getCredentials: () => null,
      },
      config: MAINNET_CONFIG,
      env: {},
      targetExplicit: true,
    }),
    new Error(AUTHENTICATION_REQUIRED_MESSAGE),
  );
});

test("requireAuthenticatedSession returns the resolved auth state", async () => {
  const auth = await requireAuthenticatedSession({
    authManager: {
      getApiKeyCredentials: () => null,
      getAuthTokenAsync: async () => "access-token",
      getAuthMethod: () => "oauth",
      getCredentials: () => ({ expiresAt: "2030-01-01T00:00:00.000Z" }),
    },
    config: MAINNET_CONFIG,
    env: {},
    targetExplicit: true,
  });
  assert.deepEqual(auth, {
    authenticated: true,
    authMethod: "oauth",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
});
