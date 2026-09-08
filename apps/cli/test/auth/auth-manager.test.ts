import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthManager,
  type OAuthCredentials,
  type RefreshTokenRequest,
} from "../../src/auth/auth-manager.js";
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
