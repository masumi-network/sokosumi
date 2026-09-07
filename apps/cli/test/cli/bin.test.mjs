import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../bin/sokosumi.mjs";

test("runs auth login through the public binary entrypoint", async () => {
  const output = [];
  const result = await main(["auth", "login", "--json"], {
    env: {
      SOKOSUMI_API_URL: "https://api.example.test",
      SOKOSUMI_OAUTH_CLIENT_ID: "cli-client",
    },
    loginFn: async () => ({
      authToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }),
    authManager: { saveCredentials: (credentials) => credentials },
    stdout: { write: (value) => output.push(value) },
  });

  assert.deepEqual(result, {
    authenticated: true,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(output.join("")), result);
});
