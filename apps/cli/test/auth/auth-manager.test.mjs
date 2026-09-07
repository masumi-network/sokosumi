import assert from "node:assert/strict";
import test from "node:test";

import { AuthManager } from "../../src/auth/auth-manager.mjs";

test("refreshes an expired OAuth session and persists the new token", async () => {
  const writes = [];
  const credentialStore = {
    read: () => ({
      authToken: "expired-access-token",
      refreshToken: "refresh-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
    }),
    write: (credentials) => writes.push(credentials),
    clear: () => {},
  };
  let refreshRequest;
  const refreshTokenFn = async (request) => {
    refreshRequest = request;
    return {
      authToken: "fresh-access-token",
      refreshToken: null,
      tokenType: "Bearer",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  };
  const manager = new AuthManager({ credentialStore, refreshTokenFn });

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
