import assert from "node:assert/strict";
import test from "node:test";

import { loginWithBrowser } from "../../src/auth/oauth.js";

interface FetchRequest {
  url: RequestInfo | URL;
  options?: RequestInit;
}

test("successful OAuth callback clears the browser URL", async () => {
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
      { headers: { connection: "close" } },
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
    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        void fetch(
          `${redirectUri}?code=auth-code&state=${encodeURIComponent(state)}`,
          { headers: { connection: "close" } },
        )
          .then((response) => response.arrayBuffer())
          .then(() => resolve(), reject);
      });
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

// SOK-1273: callback HTML reports receipt only. The terminal confirms sign-in.
function assertSafeCallback(response: Response, html: string): void {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assert.match(html, /history\.replaceState/u);
  assert.doesNotMatch(
    html,
    /auth-code|access-token|refresh-token|state=|private-description|sign-in completed|signed in/u,
  );
}

for (const scenario of [
  {
    name: "wrong state",
    query: "code=auth-code&state=wrong",
    error: /OAuth state mismatch/u,
  },
  {
    name: "missing state",
    query: "code=auth-code",
    error: /OAuth state mismatch/u,
  },
  {
    name: "missing code",
    query: "",
    error: /did not include an authorization code/u,
  },
  {
    name: "denied",
    query: "error=access_denied&error_description=private-description",
    error: /OAuth authorization failed/u,
  },
]) {
  test(`callback page reports ${scenario.name} without success (SOK-1273)`, async () => {
    let response: Response | undefined;
    let html = "";
    let tokenRequests = 0;
    await assert.rejects(
      loginWithBrowser({
        authBaseUrl: "https://api.example.test/auth",
        clientId: "cli-client",
        port: 53683,
        timeoutMs: 5000,
        fetchImpl: async () => {
          tokenRequests += 1;
          throw new Error("Invalid callbacks must not exchange tokens");
        },
        openUrl: async (authorizationUrl) => {
          const authorization = new URL(authorizationUrl);
          const callback = new URL(
            String(authorization.searchParams.get("redirect_uri")),
          );
          callback.search = scenario.query;
          if (!scenario.name.includes("state")) {
            callback.searchParams.set(
              "state",
              String(authorization.searchParams.get("state")),
            );
          }
          response = await fetch(callback, {
            headers: { connection: "close" },
          });
          html = await response.text();
        },
      }),
      scenario.error,
    );
    if (!response) throw new Error("Callback response was not captured");
    assert.equal(response.status, 400);
    assert.match(html, /<h1>Sign-in could not continue<\/h1>/u);
    assert.doesNotMatch(html, /BROWSER STEP COMPLETE/u);
    assertSafeCallback(response, html);
    assert.equal(tokenRequests, 0);
  });
}

for (const scenario of [
  {
    name: "failed token exchange",
    body: { error_description: "private-description" },
    status: 401,
    error: /OAuth token request failed/u,
  },
  {
    name: "invalid token payload",
    body: {},
    status: 200,
    error: /did not include an access token/u,
  },
]) {
  test(`terminal confirms ${scenario.name}, browser does not claim success (SOK-1273)`, async () => {
    let response: Response | undefined;
    let html = "";
    await assert.rejects(
      loginWithBrowser({
        authBaseUrl: "https://api.example.test/auth",
        clientId: "cli-client",
        port: 53683,
        timeoutMs: 5000,
        fetchImpl: async () =>
          new Response(JSON.stringify(scenario.body), {
            status: scenario.status,
          }),
        openUrl: async (authorizationUrl) => {
          const authorization = new URL(authorizationUrl);
          const callback = new URL(
            String(authorization.searchParams.get("redirect_uri")),
          );
          callback.searchParams.set("code", "auth-code");
          callback.searchParams.set(
            "state",
            String(authorization.searchParams.get("state")),
          );
          response = await fetch(callback, {
            headers: { connection: "close" },
          });
          html = await response.text();
        },
      }),
      scenario.error,
    );
    if (!response) throw new Error("Callback response was not captured");
    assert.equal(response.status, 200);
    assert.match(html, /terminal will confirm whether sign-in succeeds/u);
    assertSafeCallback(response, html);
  });
}

test("non-GET callback does not consume the pending sign-in", async () => {
  let methodResponse: Response | undefined;
  const credentials = await loginWithBrowser({
    authBaseUrl: "https://api.example.test/auth",
    clientId: "cli-client",
    port: 53683,
    timeoutMs: 5000,
    fetchImpl: async () =>
      new Response(JSON.stringify({ access_token: "access-token" })),
    openUrl: async (authorizationUrl) => {
      const authorization = new URL(authorizationUrl);
      const callback = new URL(
        String(authorization.searchParams.get("redirect_uri")),
      );
      callback.searchParams.set("code", "auth-code");
      callback.searchParams.set(
        "state",
        String(authorization.searchParams.get("state")),
      );
      methodResponse = await fetch(callback, {
        method: "POST",
        headers: { connection: "close" },
      });
      await methodResponse.arrayBuffer();
      const response = await fetch(callback, {
        headers: { connection: "close" },
      });
      const html = await response.text();
      assertSafeCallback(response, html);
      assert.equal(response.status, 200);
    },
  });
  assert.equal(methodResponse?.status, 405);
  assert.equal(methodResponse?.headers.get("allow"), "GET");
  assert.equal(credentials.authToken, "access-token");
});
