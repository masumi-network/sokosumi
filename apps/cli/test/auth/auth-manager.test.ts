import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthManager,
  type OAuthCredentials,
  type RefreshTokenRequest,
} from "../../src/auth/auth-manager.js";
import { resolveCliConfig } from "../../src/auth/config.js";
import type { CredentialStore } from "../../src/auth/secure-store.js";

const emptyApiKeyStore: CredentialStore<{ apiKey: string }> = {
  read: () => null,
  write: () => {},
  clear: () => {},
};

test("refreshes an expired OAuth session and persists the new token", async () => {
  const writes: OAuthCredentials[] = [];
  const credentialStore: CredentialStore<OAuthCredentials> = {
    read: () => ({
      authToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
    }),
    write: (credentials) => {
      writes.push(credentials);
    },
    clear: () => {},
  };
  let refreshRequest: RefreshTokenRequest | undefined;
  const refreshTokenFn = async (
    request: RefreshTokenRequest,
  ): Promise<OAuthCredentials> => {
    refreshRequest = request;
    return {
      authToken: "fresh-access-token",
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  };
  const manager = new AuthManager({
    credentialStore,
    apiKeyStore: emptyApiKeyStore,
    refreshTokenFn,
    environment: {},
  });

  const token = await manager.getAuthTokenAsync({
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
  });

  assert.equal(token, "fresh-access-token");
  assert.deepEqual(refreshRequest, {
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    clientSecret: undefined,
    refreshToken: "refresh-token",
  });
  assert.deepEqual(writes, [
    {
      authToken: "fresh-access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
  ]);
});
test("hosted OAuth refresh uses the resolved first-party client", async () => {
  const config = resolveCliConfig({
    env: { SOKOSUMI_API_URL: "https://api.sokosumi.com" },
  });
  let refreshRequest: RefreshTokenRequest | undefined;
  const manager = new AuthManager({
    credentialStore: {
      read: () => ({
        authToken: "expired-access-token",
        refreshToken: "refresh-token",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
      write: () => {},
      clear: () => {},
    },
    apiKeyStore: emptyApiKeyStore,
    refreshTokenFn: async (request) => {
      refreshRequest = request;
      return { authToken: "fresh-access-token" };
    },
    environment: {},
  });

  assert.equal(
    await manager.getAuthTokenAsync({
      authBaseUrl: config.authBaseUrl,
      clientId: config.clientId,
    }),
    "fresh-access-token",
  );
  assert.equal(refreshRequest?.authBaseUrl, "https://api.sokosumi.com/auth");
  assert.equal(refreshRequest?.clientId, "GxmewjdHVAaqUEglxWdyCqVFvnTASycj");
});

test("TestV16 hosted refresh does not use an unconfigured fallback client", async () => {
  let refreshed = false;
  const manager = new AuthManager({
    credentialStore: {
      read: () => ({
        authToken: "expired-access-token",
        refreshToken: "refresh-token",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
      write: () => {},
      clear: () => {},
    },
    apiKeyStore: emptyApiKeyStore,
    refreshTokenFn: async () => {
      refreshed = true;
      return { authToken: "fresh-access-token" };
    },
    environment: {},
  });

  assert.equal(
    await manager.getAuthTokenAsync({
      authBaseUrl: "https://api.sokosumi.com/auth",
    }),
    null,
  );
  assert.equal(refreshed, false);
});

test("keeps an API key in memory when no vault is available", () => {
  const manager = new AuthManager({
    credentialStore: {
      read: () => null,
      write: () => {},
      clear: () => {},
    },
    apiKeyStore: {
      isSupported: false,
      read: () => null,
      write: () => {
        throw new Error("should not write");
      },
      clear: () => {},
    },
  });

  manager.saveApiKey({ apiKey: "soko_mainnet_key", target: "mainnet" });

  assert.equal(manager.getAuthToken(), "soko_mainnet_key");
  assert.equal(manager.isApiKeyPersistent(), false);
});
