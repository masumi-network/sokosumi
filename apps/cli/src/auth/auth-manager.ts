import { MAINNET_OAUTH_CLIENT_ID, resolveCliConfig } from "./config.js";
import { refreshAccessToken } from "./oauth.js";
import {
  type CredentialStore,
  createAuthCredentialStores,
  createCredentialStore,
} from "./secure-store.js";

export interface OAuthCredentials {
  authToken: string;
  refreshToken?: string | null;
  tokenType?: string;
  expiresAt?: string | null;
  /** The OAuth client the tokens were issued to; refresh always uses it. */
  clientId?: string;
}

interface UserApiKeyCredentials {
  apiKey: string;
  expiresAt?: string | null;
  target?: string;
}

export interface RefreshTokenRequest {
  authBaseUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

type RefreshTokenFn = (
  request: RefreshTokenRequest,
) => Promise<OAuthCredentials>;

export interface AuthEnvironment {
  readonly SOKOSUMI_AUTH_TOKEN?: string;
  readonly SOKOSUMI_API_KEY?: string;
  readonly SOKOSUMI_OAUTH_CLIENT_ID?: string;
  readonly SOKOSUMI_OAUTH_CLIENT_SECRET?: string;
  readonly SOKOSUMI_AUTH_URL?: string;
  readonly SOKOSUMI_API_URL?: string;
  readonly [key: string]: string | undefined;
}

interface AuthManagerOptions {
  credentialStore?: CredentialStore<OAuthCredentials>;
  apiKeyStore?: CredentialStore<UserApiKeyCredentials>;
  refreshTokenFn?: RefreshTokenFn;
  environment?: AuthEnvironment;
}

export function envBearerCredential(environment: AuthEnvironment): {
  method: "api-key" | "oauth";
  token: string;
} | null {
  const apiKey = String(environment.SOKOSUMI_API_KEY || "").trim();
  if (apiKey) return { method: "api-key", token: apiKey };
  const authToken = String(environment.SOKOSUMI_AUTH_TOKEN || "").trim();
  if (authToken) return { method: "oauth", token: authToken };
  return null;
}

function hasUsableExpiry(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && Date.now() < expiry - 5 * 60 * 1000;
}

export class AuthManager {
  private readonly credentialStore: CredentialStore<OAuthCredentials>;
  private readonly apiKeyStore: CredentialStore<UserApiKeyCredentials>;
  private readonly refreshTokenFn: RefreshTokenFn;
  private readonly environment: AuthEnvironment;
  private credentials: OAuthCredentials | null | undefined;
  private apiKeyCredentials: UserApiKeyCredentials | null | undefined;
  private apiKeyPersistent: boolean;
  private refreshPromise: Promise<string | null> | null;

  constructor({
    credentialStore = createCredentialStore<OAuthCredentials>(),
    apiKeyStore = createCredentialStore<UserApiKeyCredentials>({
      accountName: "user-api-key",
    }),
    refreshTokenFn = refreshAccessToken,
    environment = process.env,
  }: AuthManagerOptions = {}) {
    this.credentialStore = credentialStore;
    this.apiKeyStore = apiKeyStore;
    this.refreshTokenFn = refreshTokenFn;
    this.environment = environment;
    this.credentials = undefined;
    this.apiKeyCredentials = undefined;
    this.apiKeyPersistent = true;
    this.refreshPromise = null;
  }

  // Each OS vault read can trigger a macOS keychain prompt, so read lazily.
  private storedCredentials(): OAuthCredentials | null {
    if (this.credentials === undefined) {
      this.credentials = this.credentialStore.read();
    }
    return this.credentials;
  }

  private storedApiKeyCredentials(): UserApiKeyCredentials | null {
    if (this.apiKeyCredentials === undefined) {
      this.apiKeyCredentials = this.apiKeyStore.read();
    }
    return this.apiKeyCredentials;
  }

  saveCredentials(credentials: OAuthCredentials): OAuthCredentials {
    if (
      !credentials ||
      typeof credentials !== "object" ||
      typeof credentials.authToken !== "string" ||
      credentials.authToken.trim().length === 0
    ) {
      throw new TypeError("authToken is required");
    }
    this.credentialStore.write(credentials);
    this.credentials = credentials;
    return credentials;
  }

  saveApiKey(credentials: UserApiKeyCredentials): UserApiKeyCredentials {
    if (
      !credentials ||
      typeof credentials !== "object" ||
      typeof credentials.apiKey !== "string" ||
      credentials.apiKey.trim().length === 0
    ) {
      throw new TypeError("apiKey is required");
    }
    if (this.apiKeyStore.isSupported === false) {
      this.apiKeyCredentials = credentials;
      this.apiKeyPersistent = false;
      return credentials;
    }
    this.apiKeyStore.write(credentials);
    this.apiKeyCredentials = credentials;
    this.apiKeyPersistent = true;
    return credentials;
  }

  logout(): void {
    this.credentials = null;
    this.apiKeyCredentials = null;
    this.apiKeyPersistent = true;
    this.refreshPromise = null;
    this.credentialStore.clear();
    this.apiKeyStore.clear();
  }

  isTokenExpired(): boolean {
    const expiresAt = this.storedCredentials()?.expiresAt;
    if (!expiresAt) return false;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) return true;
    return Date.now() >= expiry - 5 * 60 * 1000;
  }

  getAuthMethod(
    environment: AuthEnvironment = this.environment,
  ): "oauth" | "api-key" | null {
    const envBearer = envBearerCredential(environment);
    if (envBearer) return envBearer.method;
    const credentials = this.storedCredentials();
    if (credentials?.authToken && !this.isTokenExpired()) return "oauth";
    const apiKeyCredentials = this.storedApiKeyCredentials();
    if (
      apiKeyCredentials?.apiKey &&
      hasUsableExpiry(apiKeyCredentials.expiresAt)
    ) {
      return "api-key";
    }
    return credentials?.refreshToken ? "oauth" : null;
  }

  getAuthToken(environment: AuthEnvironment = this.environment): string | null {
    const envBearer = envBearerCredential(environment);
    if (envBearer) return envBearer.token;
    const credentials = this.storedCredentials();
    if (credentials?.authToken && !this.isTokenExpired()) {
      return credentials.authToken;
    }
    const apiKeyCredentials = this.storedApiKeyCredentials();
    if (
      apiKeyCredentials?.apiKey &&
      hasUsableExpiry(apiKeyCredentials.expiresAt)
    ) {
      return apiKeyCredentials.apiKey;
    }
    return null;
  }

  async getAuthTokenAsync({
    authBaseUrl,
    clientId,
    clientSecret,
    environment = this.environment,
  }: {
    authBaseUrl?: string;
    clientId?: string;
    clientSecret?: string;
    environment?: AuthEnvironment;
  } = {}): Promise<string | null> {
    const existing = this.getAuthToken(environment);
    if (existing) return existing;

    const stored = this.storedCredentials();
    const refreshToken = stored?.refreshToken || null;
    // A refresh token only works with the client it was issued to.
    const resolvedClientId = String(
      stored?.clientId ||
        clientId ||
        environment.SOKOSUMI_OAUTH_CLIENT_ID ||
        "",
    ).trim();
    if (!refreshToken || !resolvedClientId) return null;

    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        const refreshed = await this.refreshTokenFn({
          authBaseUrl:
            authBaseUrl || resolveCliConfig({ env: environment }).authBaseUrl,
          clientId: resolvedClientId,
          clientSecret:
            clientSecret ||
            environment.SOKOSUMI_OAUTH_CLIENT_SECRET ||
            undefined,
          refreshToken,
        });
        const nextCredentials: OAuthCredentials = {
          ...this.credentials,
          ...refreshed,
          authToken: refreshed.authToken,
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

  getCredentials(): OAuthCredentials | null {
    return this.storedCredentials();
  }

  getApiKeyCredentials(): UserApiKeyCredentials | null {
    return this.storedApiKeyCredentials();
  }
  isApiKeyPersistent(): boolean {
    return this.apiKeyPersistent;
  }
}

const authManagerInstances = new Map<string, AuthManager>();

export function getAuthManager({
  targetScope = "mainnet",
  clientId = MAINNET_OAUTH_CLIENT_ID,
  environment = process.env,
}: {
  targetScope?: string;
  clientId?: string;
  environment?: AuthEnvironment;
} = {}): AuthManager {
  const key = `${targetScope}:${clientId}`;
  const existing = authManagerInstances.get(key);
  if (existing) return existing;
  const stores = createAuthCredentialStores<
    OAuthCredentials,
    UserApiKeyCredentials
  >({ targetScope, clientId });
  const manager = new AuthManager({
    credentialStore: stores.oauth,
    apiKeyStore: stores.apiKey,
    environment,
  });
  authManagerInstances.set(key, manager);
  return manager;
}
