import assert from "node:assert/strict";
import test from "node:test";

import { loginWithBrowser } from "../../src/auth/oauth.js";

interface FetchRequest {
  url: RequestInfo | URL;
  options?: RequestInit;
}

test("TestV25 successful OAuth callback clears the browser URL", async () => {
  let callbackResponsePromise: Promise<Response> | undefined;
  const fetchImpl: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 7200,
      }),
      { status: 200 },
    );
  };
  const openUrl = async (authorizationUrl: string) => {
    const authorization = new URL(authorizationUrl);
    const redirectUri = authorization.searchParams.get("redirect_uri");
    const state = authorization.searchParams.get("state");
    if (!redirectUri || !state) throw new Error("OAuth URL was incomplete");
    callbackResponsePromise = fetch(
      `${redirectUri}?code=auth-code&state=${encodeURIComponent(state)}`,
    );
  };

  await loginWithBrowser({
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    port: 53683,
    openUrl,
    fetchImpl,
    timeoutMs: 5000,
  });

  if (!callbackResponsePromise) {
    throw new Error("OAuth callback request was not captured");
  }
  const callbackResponse = await callbackResponsePromise;
  const callbackBody = await callbackResponse.text();
  assert.equal(callbackResponse.status, 200);
  assert.match(callbackBody, /history\.replaceState/u);
  assert.doesNotMatch(callbackBody, /auth-code|state=/u);
});

test("completes browser OAuth through the loopback callback", async () => {
  let tokenRequest: FetchRequest | undefined;
  const fetchImpl: typeof fetch = async (url, options) => {
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
  const openUrl = async (authorizationUrl: string) => {
    const authorization = new URL(authorizationUrl);
    const redirectUri = authorization.searchParams.get("redirect_uri");
    const state = authorization.searchParams.get("state");
    if (!redirectUri || !state) throw new Error("OAuth URL was incomplete");
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
  assert.equal(tokenRequest?.url, "https://api.example.test/auth/oauth2/token");
  if (!tokenRequest?.options) throw new Error("fetch request was not captured");
  const body = new URLSearchParams(String(tokenRequest.options.body));
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.ok(body.get("code_verifier"));
});

test("stops waiting when browser launch fails", async () => {
  const launchError = new Error("spawn xdg-open ENOENT");

  await assert.rejects(
    loginWithBrowser({
      authBaseUrl: "https://api.example.test/auth",
      clientId: "cli-client",
      port: 53684,
      openUrl: async () => {
        throw launchError;
      },
      timeoutMs: 30_000,
    }),
    launchError,
  );
});
