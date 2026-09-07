import { getAuthManager } from "../auth/auth-manager.mjs";
import { loginWithBrowser } from "../auth/oauth.mjs";

/** Matches Core `FIRST_PARTY_CLI_OAUTH_CLIENT_ID`. Public native client. */
const DEFAULT_OAUTH_CLIENT_ID = "sokosumi_cli";

function resolveAuthBaseUrl(env) {
  const explicit = String(env.SOKOSUMI_AUTH_URL || "").trim();
  if (explicit) return explicit;

  const apiUrl = String(env.SOKOSUMI_API_URL || "https://api.sokosumi.com")
    .trim()
    .replace(/\/+$/g, "");
  return `${apiUrl}/auth`;
}

function writeResult(stdout, result, json) {
  if (json) {
    stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  stdout.write(
    `OAuth login complete. Token expires: ${result.expiresAt || "unknown"}\n`,
  );
}

export async function runAuthLogin({
  env = process.env,
  authBaseUrl,
  clientId,
  clientSecret,
  port,
  callbackPath,
  timeoutMs,
  json = false,
  loginFn = loginWithBrowser,
  authManager = getAuthManager(),
  stdout = process.stdout,
  signal,
} = {}) {
  const resolvedClientId = String(
    clientId || env.SOKOSUMI_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID,
  ).trim();

  const resolvedClientSecret = String(
    clientSecret || env.SOKOSUMI_OAUTH_CLIENT_SECRET || "",
  ).trim();
  const loginRequest = {
    authBaseUrl: authBaseUrl || resolveAuthBaseUrl(env),
    clientId: resolvedClientId,
    ...(resolvedClientSecret ? { clientSecret: resolvedClientSecret } : {}),
    ...(port === undefined ? {} : { port }),
    ...(callbackPath === undefined ? {} : { callbackPath }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  };
  const credentials = await loginFn(loginRequest);
  authManager.saveCredentials(credentials);

  const result = {
    authenticated: true,
    expiresAt: credentials.expiresAt || null,
  };
  writeResult(stdout, result, json);
  return result;
}
