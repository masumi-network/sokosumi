import { spawn as defaultSpawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const DEFAULT_OAUTH_SCOPE = "openid sokosumi:api offline_access";

function trimBaseUrl(value, label) {
  const base = String(value || "")
    .trim()
    .replace(/\/+$/g, "");
  if (!base) throw new Error(`${label} is required`);
  try {
    const parsed = new URL(base);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    return parsed.toString().replace(/\/+$/g, "");
  } catch {
    throw new Error(`${label} must be a valid HTTP URL`);
  }
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function buildAuthorizationUrl({
  authBaseUrl,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scope = DEFAULT_OAUTH_SCOPE,
} = {}) {
  const url = new URL(
    `${trimBaseUrl(authBaseUrl, "authBaseUrl")}/oauth2/authorize`,
  );
  url.searchParams.set("client_id", requireText(clientId, "clientId"));
  url.searchParams.set("redirect_uri", requireText(redirectUri, "redirectUri"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", requireText(scope, "scope"));
  url.searchParams.set("state", requireText(state, "state"));
  url.searchParams.set(
    "code_challenge",
    requireText(codeChallenge, "codeChallenge"),
  );
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function parseOAuthCallback(callbackUrl, { expectedState } = {}) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("OAuth callback URL is invalid");
  }

  const receivedState = url.searchParams.get("state");
  if (!receivedState || receivedState !== expectedState) {
    throw new Error("OAuth state mismatch");
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description");
    throw new Error(
      `OAuth authorization failed: ${oauthError}${description ? ` (${description})` : ""}`,
    );
  }

  const code = url.searchParams.get("code");
  if (!code)
    throw new Error("OAuth callback did not include an authorization code");
  return { code };
}

function normalizeTokenResponse(payload) {
  const accessToken =
    typeof payload?.access_token === "string"
      ? payload.access_token.trim()
      : "";
  if (!accessToken)
    throw new Error("OAuth token response did not include an access token");

  const expiresIn = Number(payload.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

  return {
    authToken: accessToken,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token.trim()
        ? payload.refresh_token.trim()
        : null,
    tokenType:
      typeof payload.token_type === "string" && payload.token_type.trim()
        ? payload.token_type.trim()
        : "Bearer",
    expiresAt,
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof payload === "object" && payload?.error_description
        ? `OAuth token request failed: ${payload.error_description}`
        : `OAuth token request failed with status ${response.status}`,
    );
    error.status = response.status;
    error.body = payload;
    throw error;
  }

  return payload;
}

async function postTokenRequest({
  authBaseUrl,
  body,
  fetchImpl = globalThis.fetch,
  signal,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is required for OAuth token exchange");
  }
  const response = await fetchImpl(
    `${trimBaseUrl(authBaseUrl, "authBaseUrl")}/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal,
    },
  );
  return normalizeTokenResponse(await parseResponse(response));
}

export async function exchangeAuthorizationCode({
  authBaseUrl,
  clientId,
  clientSecret,
  redirectUri,
  code,
  codeVerifier,
  fetchImpl,
  signal,
} = {}) {
  const body = {
    grant_type: "authorization_code",
    client_id: requireText(clientId, "clientId"),
    redirect_uri: requireText(redirectUri, "redirectUri"),
    code: requireText(code, "code"),
    code_verifier: requireText(codeVerifier, "codeVerifier"),
  };
  if (clientSecret) body.client_secret = String(clientSecret).trim();
  return postTokenRequest({ authBaseUrl, body, fetchImpl, signal });
}

export async function refreshAccessToken({
  authBaseUrl,
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl,
  signal,
} = {}) {
  const body = {
    grant_type: "refresh_token",
    client_id: requireText(clientId, "clientId"),
    refresh_token: requireText(refreshToken, "refreshToken"),
  };
  if (clientSecret) body.client_secret = String(clientSecret).trim();
  return postTokenRequest({ authBaseUrl, body, fetchImpl, signal });
}

export const DEFAULT_OAUTH_REDIRECT_PORT = 53682;
export const DEFAULT_OAUTH_REDIRECT_PATH = "/oauth/callback";

function openWithCommand(command, args, { spawnImpl = defaultSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    child.once?.("error", reject);
    child.unref?.();
    resolve();
  });
}

export function openInBrowser(
  url,
  { platform = process.platform, spawnImpl = defaultSpawn } = {},
) {
  const target = requireText(url, "url");
  if (platform === "darwin")
    return openWithCommand("open", [target], { spawnImpl });
  if (platform === "win32") {
    return openWithCommand("cmd", ["/c", "start", "", target], { spawnImpl });
  }
  return openWithCommand("xdg-open", [target], { spawnImpl });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off?.("listening", onListening);
      reject(
        new Error(`Could not start OAuth callback server: ${error.message}`),
      );
    };
    const onListening = () => {
      server.off?.("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || typeof server.close !== "function") {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function waitForCallback({ server, callbackPath, timeoutMs, signal, port }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () =>
      finish(reject, new Error("OAuth login was cancelled"));
    const timeout = setTimeout(
      () =>
        finish(
          reject,
          new Error("OAuth login timed out waiting for the browser callback"),
        ),
      timeoutMs,
    );

    server.on("request", (request, response) => {
      let url;
      try {
        url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
      } catch {
        response.statusCode = 400;
        response.end("Invalid callback");
        return;
      }

      if (url.pathname !== callbackPath) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.statusCode = 200;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end("Sokosumi sign-in completed. You can close this window.");
      finish(resolve, url.toString());
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function loginWithBrowser({
  authBaseUrl,
  clientId,
  clientSecret,
  scope = DEFAULT_OAUTH_SCOPE,
  port = DEFAULT_OAUTH_REDIRECT_PORT,
  callbackPath = DEFAULT_OAUTH_REDIRECT_PATH,
  timeoutMs = 5 * 60 * 1000,
  openUrl = (url) => openInBrowser(url),
  serverFactory = () => createServer(),
  fetchImpl,
  signal,
} = {}) {
  const resolvedClientId = requireText(clientId, "clientId");
  const resolvedPort = Number(port);
  if (
    !Number.isInteger(resolvedPort) ||
    resolvedPort < 1 ||
    resolvedPort > 65535
  ) {
    throw new Error(
      "OAuth callback port must be an integer between 1 and 65535",
    );
  }
  const resolvedPath = callbackPath.startsWith("/")
    ? callbackPath
    : `/${callbackPath}`;
  const pkce = createPkcePair();
  const state = randomBytes(32).toString("base64url");
  const redirectUri = `http://127.0.0.1:${resolvedPort}${resolvedPath}`;
  const server = serverFactory();

  try {
    await listen(server, resolvedPort);
    const authorizationUrl = buildAuthorizationUrl({
      authBaseUrl,
      clientId: resolvedClientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
      scope,
    });
    const callbackPromise = waitForCallback({
      server,
      callbackPath: resolvedPath,
      timeoutMs,
      signal,
      port: resolvedPort,
    });
    await openUrl(authorizationUrl);
    const callbackUrl = await callbackPromise;
    const { code } = parseOAuthCallback(callbackUrl, { expectedState: state });
    return exchangeAuthorizationCode({
      authBaseUrl,
      clientId: resolvedClientId,
      clientSecret,
      redirectUri,
      code,
      codeVerifier: pkce.verifier,
      fetchImpl,
      signal,
    });
  } finally {
    await closeServer(server);
  }
}
