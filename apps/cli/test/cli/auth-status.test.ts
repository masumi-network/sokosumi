import assert from "node:assert/strict";
import test from "node:test";

import { AuthManager } from "../../src/auth/auth-manager.js";
import type { CliTargetConfig } from "../../src/auth/config.js";
import { runAuthStatus } from "../../src/cli/auth-status.js";

const config: CliTargetConfig = {
  target: "custom",
  apiUrl: "https://user:password@host/api?api_key=secret&region=west#fragment",
  authBaseUrl: "https://user:password@host/auth?api_key=secret",
  clientId: "client",
  clientSecret: "",
};

function createAuthManager() {
  let requestUrl: string | undefined;
  return {
    getApiKeyCredentials: () => null,
    getAuthTokenAsync: async (options: { authBaseUrl: string }) => {
      requestUrl = options.authBaseUrl;
      return null;
    },
    getAuthMethod: () => null,
    getCredentials: () => null,
    getRequestUrl: () => requestUrl,
  };
}

test("auth status sanitizes API URLs in JSON and text output", async () => {
  for (const json of [true, false]) {
    const output: string[] = [];
    const authManager = createAuthManager();
    const result = await runAuthStatus({
      config,
      authManager,
      stdout: { write: (value) => output.push(value) },
      json,
    });

    assert.equal(
      authManager.getRequestUrl(),
      "https://user:password@host/auth?api_key=secret",
    );
    assert.equal(result.apiUrl, "https://host/api?region=west");
    assert.match(output.join(""), /https:\/\/host\/api\?region=west/);
    assert.doesNotMatch(output.join(""), /user|password|secret|fragment/i);
  }
});

test("auth status with an environment OAuth token never reads the OS vault", async () => {
  const vault = {
    read: () => {
      throw new Error("OS vault read would show a keychain prompt");
    },
    write: () => {},
    clear: () => {},
  };
  const env = { SOKOSUMI_AUTH_TOKEN: "oauth-access-token" };
  const result = await runAuthStatus({
    env,
    config,
    authManager: new AuthManager({
      credentialStore: vault,
      apiKeyStore: vault,
      environment: env,
    }),
    stdout: { write: () => {} },
    json: true,
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.apiKeyAvailable, false);
});
