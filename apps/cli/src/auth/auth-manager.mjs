import { refreshAccessToken } from "./oauth.mjs";
import { keychainCredentialStore } from "./secure-store.mjs";

const AUTH_TOKEN_ENV_NAME = "SOKOSUMI_AUTH_TOKEN";
const OAUTH_CLIENT_ID_ENV_NAME = "SOKOSUMI_OAUTH_CLIENT_ID";
const OAUTH_CLIENT_SECRET_ENV_NAME = "SOKOSUMI_OAUTH_CLIENT_SECRET";
/** Matches Core `FIRST_PARTY_CLI_OAUTH_CLIENT_ID`. Public native client. */
const DEFAULT_OAUTH_CLIENT_ID = "sokosumi_cli";

function getAuthBaseUrlFromEnv() {
  const explicit = String(process.env.SOKOSUMI_AUTH_URL || "").trim();
  if (explicit) return explicit;

  const apiUrl = String(
    process.env.SOKOSUMI_API_URL || "https://api.sokosumi.com",
  )
    .trim()
    .replace(/\/+$/g, "");
  return `${apiUrl}/auth`;
}

export class AuthManager {
  constructor({
    credentialStore = keychainCredentialStore,
    refreshTokenFn = refreshAccessToken,
  } = {}) {
    this.credentialStore = credentialStore;
    this.refreshTokenFn = refreshTokenFn;
    this.credentials = null;
    this.refreshPromise = null;
    this.loadCredentials();
  }

  loadCredentials() {
    this.credentials = this.credentialStore.read();
    return this.credentials;
  }

  saveCredentials(credentials) {
    if (
      !credentials ||
      typeof credentials !== "object" ||
      !credentials.authToken
    ) {
      throw new TypeError("authToken is required");
    }
    this.credentialStore.write(credentials);
    this.credentials = credentials;
    return credentials;
  }

  logout() {
    this.credentials = null;
    this.refreshPromise = null;
    this.credentialStore.clear();
  }

  isAuthenticated() {
    if (!this.credentials?.authToken) return false;
    return !this.isTokenExpired();
  }

  isTokenExpired() {
    if (!this.credentials?.expiresAt) return false;

    const expiry = Date.parse(this.credentials.expiresAt);
    if (!Number.isFinite(expiry)) return true;
    return Date.now() >= expiry - 5 * 60 * 1000;
  }

  getAuthToken() {
    const envToken = String(process.env[AUTH_TOKEN_ENV_NAME] || "").trim();
    if (envToken) return envToken;
    if (!this.isAuthenticated()) return null;
    return this.credentials.authToken;
  }

  async getAuthTokenAsync({ authBaseUrl, clientId, clientSecret } = {}) {
    const envToken = String(process.env[AUTH_TOKEN_ENV_NAME] || "").trim();
    if (envToken) return envToken;
    if (this.isAuthenticated()) return this.credentials.authToken;

    const refreshToken = this.credentials?.refreshToken || null;
    const resolvedClientId = String(
      clientId ||
        process.env[OAUTH_CLIENT_ID_ENV_NAME] ||
        DEFAULT_OAUTH_CLIENT_ID,
    ).trim();
    if (!refreshToken || !resolvedClientId) return null;

    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        const refreshed = await this.refreshTokenFn({
          authBaseUrl: authBaseUrl || getAuthBaseUrlFromEnv(),
          clientId: resolvedClientId,
          clientSecret:
            clientSecret || process.env[OAUTH_CLIENT_SECRET_ENV_NAME],
          refreshToken,
        });
        const nextCredentials = {
          ...this.credentials,
          ...refreshed,
          refreshToken: refreshed.refreshToken || refreshToken,
        };
        this.saveCredentials(nextCredentials);
        return nextCredentials.authToken;
      })();
    }

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  getRefreshToken() {
    return this.credentials?.refreshToken || null;
  }

  getUserId() {
    return this.credentials?.userId || null;
  }

  getUserEmail() {
    return this.credentials?.email || null;
  }

  hasStoredCredentials() {
    return Boolean(this.credentialStore.read());
  }

  getCredentials() {
    return this.credentials;
  }
}

let authManagerInstance = null;

export function getAuthManager() {
  if (!authManagerInstance) authManagerInstance = new AuthManager();
  return authManagerInstance;
}
