import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  parseOAuthCallback,
  refreshAccessToken,
} from "../../src/auth/oauth.mjs";

test("creates a PKCE verifier and matching S256 challenge", () => {
  const pair = createPkcePair();
  const expectedChallenge = createHash("sha256")
    .update(pair.verifier)
    .digest("base64url");

  assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/);
  assert.equal(pair.challenge, expectedChallenge);
});

test("builds an authorization URL without client secrets", () => {
  const url = buildAuthorizationUrl({
    authBaseUrl: "https://api.example.test/auth/",
    clientId: "cli-client",
    redirectUri: "http://127.0.0.1:53682/oauth/callback",
    state: "state-value",
    codeChallenge: "challenge-value",
    scope: "openid sokosumi:api offline_access",
  });

  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/auth/oauth2/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "cli-client");
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "http://127.0.0.1:53682/oauth/callback",
  );
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("code_challenge"), "challenge-value");
  assert.equal(
    parsed.searchParams.get("scope"),
    "openid sokosumi:api offline_access",
  );
  assert.equal(parsed.searchParams.get("state"), "state-value");
  assert.equal(parsed.searchParams.get("client_secret"), null);
});

test("accepts only the expected OAuth callback state", () => {
  const callback = parseOAuthCallback(
    "http://127.0.0.1:53682/oauth/callback?code=auth-code&state=state-value",
    { expectedState: "state-value" },
  );

  assert.deepEqual(callback, { code: "auth-code" });
  assert.throws(
    () =>
      parseOAuthCallback(
        "http://127.0.0.1:53682/oauth/callback?code=auth-code&state=wrong",
        { expectedState: "state-value" },
      ),
    /state mismatch/,
  );
  assert.throws(
    () =>
      parseOAuthCallback(
        "http://127.0.0.1:53682/oauth/callback?error=access_denied&state=state-value",
        { expectedState: "state-value" },
      ),
    /access_denied/,
  );
});

test("exchanges an authorization code using form encoding", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
        expires_in: 7200,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const credentials = await exchangeAuthorizationCode({
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    redirectUri: "http://127.0.0.1:53682/oauth/callback",
    code: "auth-code",
    codeVerifier: "verifier",
    fetchImpl,
  });

  assert.equal(request.url, "https://api.example.test/auth/oauth2/token");
  assert.equal(request.options.method, "POST");
  assert.equal(
    request.options.headers["content-type"],
    "application/x-www-form-urlencoded",
  );
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("client_id"), "cli-client");
  assert.equal(
    body.get("redirect_uri"),
    "http://127.0.0.1:53682/oauth/callback",
  );
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("code_verifier"), "verifier");
  assert.equal(credentials.authToken, "access-token");
  assert.equal(credentials.refreshToken, "refresh-token");
  assert.equal(credentials.tokenType, "Bearer");
  assert.ok(Date.parse(credentials.expiresAt) >= Date.now() + 7_000_000);
});

test("refreshes an access token with the refresh token", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(
      JSON.stringify({
        access_token: "fresh-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }),
      { status: 200 },
    );
  };

  const credentials = await refreshAccessToken({
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    refreshToken: "refresh-token",
    fetchImpl,
  });

  assert.equal(request.url, "https://api.example.test/auth/oauth2/token");
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(body.get("client_id"), "cli-client");
  assert.equal(body.get("refresh_token"), "refresh-token");
  assert.equal(credentials.authToken, "fresh-access-token");
  assert.equal(credentials.refreshToken, "new-refresh-token");
});
