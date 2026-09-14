import assert from "node:assert/strict";
import test from "node:test";

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

test("TestV55 auth status sanitizes API URLs in JSON and text output", async () => {
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
