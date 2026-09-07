import assert from "node:assert/strict";
import test from "node:test";

import { loginWithBrowser } from "../../src/auth/oauth.mjs";

test("completes browser OAuth through the loopback callback", async () => {
  let tokenRequest;
  const fetchImpl = async (url, options) => {
    tokenRequest = { url, options };
    return new Response(
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 7200,
      }),
      { status: 200 },
    );
  };
  const openUrl = async (authorizationUrl) => {
    const authorization = new URL(authorizationUrl);
    const redirectUri = authorization.searchParams.get("redirect_uri");
    const state = authorization.searchParams.get("state");
    setImmediate(() => {
      fetch(
        `${redirectUri}?code=auth-code&state=${encodeURIComponent(state)}`,
      ).catch(() => {});
    });
  };

  const credentials = await loginWithBrowser({
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    port: 53683,
    openUrl,
    fetchImpl,
    timeoutMs: 5000,
  });

  assert.equal(credentials.authToken, "access-token");
  assert.equal(credentials.refreshToken, "refresh-token");
  assert.equal(tokenRequest.url, "https://api.example.test/auth/oauth2/token");
  const body = new URLSearchParams(tokenRequest.options.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.ok(body.get("code_verifier"));
});
