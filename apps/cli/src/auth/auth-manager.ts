import { DEFAULT_OAUTH_CLIENT_ID } from "./config.js";
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
  userId?: string | null;
  email?: string | null;
}

export interface UserApiKeyCredentials {
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

export type RefreshTokenFn = (
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

export interface AuthManagerOptions {
  credentialStore?: CredentialStore<OAuthCredentials>;
  apiKeyStore?: CredentialStore<UserApiKeyCredentials>;
  refreshTokenFn?: RefreshTokenFn;
  environment?: AuthEnvironment;
}

function getAuthBaseUrlFromEnvironment(environment: AuthEnvironment): string {
  const explicit = String(environment.SOKOSUMI_AUTH_URL || "").trim();
  if (explicit) return explicit;

  const apiUrl = String(
    environment.SOKOSUMI_API_URL || "https://api.sokosumi.com",
  )
    .trim()
    .replace(/\/+$/g, "");
  return `${apiUrl}/auth`;
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
  private credentials: OAuthCredentials | null;
  private apiKeyCredentials: UserApiKeyCredentials | null;
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
    this.credentials = null;
    this.apiKeyCredentials = null;
    this.apiKeyPersistent = true;
    this.refreshPromise = null;
    this.loadCredentials();
  }

  loadCredentials(): OAuthCredentials | null {
    this.credentials = this.credentialStore.read();
    this.apiKeyCredentials = this.apiKeyStore.read();
    return this.credentials;
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

  isAuthenticated(): boolean {
    return Boolean(
      (this.credentials?.authToken && !this.isTokenExpired()) ||
        (this.apiKeyCredentials?.apiKey &&
          hasUsableExpiry(this.apiKeyCredentials.expiresAt)),
    );
  }

  isTokenExpired(): boolean {
    if (!this.credentials?.expiresAt) return false;
    const expiry = Date.parse(this.credentials.expiresAt);
    if (!Number.isFinite(expiry)) return true;
    return Date.now() >= expiry - 5 * 60 * 1000;
  }

  getAuthMethod(
    environment: AuthEnvironment = this.environment,
  ): "oauth" | "api-key" | null {
    if (String(environment.SOKOSUMI_API_KEY || "").trim()) return "api-key";
    if (String(environment.SOKOSUMI_AUTH_TOKEN || "").trim()) return "oauth";
    if (this.credentials?.authToken && !this.isTokenExpired()) return "oauth";
    if (
      this.apiKeyCredentials?.apiKey &&
      hasUsableExpiry(this.apiKeyCredentials.expiresAt)
    ) {
      return "api-key";
    }
    return this.credentials?.refreshToken ? "oauth" : null;
  }

  getAuthToken(environment: AuthEnvironment = this.environment): string | null {
    const envApiKey = String(environment.SOKOSUMI_API_KEY || "").trim();
    if (envApiKey) return envApiKey;
    const envToken = String(environment.SOKOSUMI_AUTH_TOKEN || "").trim();
    if (envToken) return envToken;
    if (this.credentials?.authToken && !this.isTokenExpired()) {
      return this.credentials.authToken;
    }
    if (
      this.apiKeyCredentials?.apiKey &&
      hasUsableExpiry(this.apiKeyCredentials.expiresAt)
    ) {
      return this.apiKeyCredentials.apiKey;
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
    const envApiKey = String(environment.SOKOSUMI_API_KEY || "").trim();
    if (envApiKey) return envApiKey;
    const envToken = String(environment.SOKOSUMI_AUTH_TOKEN || "").trim();
    if (envToken) return envToken;
    if (this.credentials?.authToken && !this.isTokenExpired()) {
      return this.credentials.authToken;
    }
    if (
      this.apiKeyCredentials?.apiKey &&
      hasUsableExpiry(this.apiKeyCredentials.expiresAt)
    ) {
      return this.apiKeyCredentials.apiKey;
    }

    const refreshToken = this.credentials?.refreshToken || null;
    const resolvedClientId = String(
      clientId ||
        environment.SOKOSUMI_OAUTH_CLIENT_ID ||
        DEFAULT_OAUTH_CLIENT_ID,
    ).trim();
    if (!refreshToken || !resolvedClientId) return null;

    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        const refreshed = await this.refreshTokenFn({
          authBaseUrl:
            authBaseUrl || getAuthBaseUrlFromEnvironment(environment),
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

  getRefreshToken(): string | null {
    return this.credentials?.refreshToken || null;
  }

  getUserId(): string | null {
    return this.credentials?.userId || null;
  }

  getUserEmail(): string | null {
    return this.credentials?.email || null;
  }

  hasStoredCredentials(): boolean {
    return Boolean(this.credentialStore.read() || this.apiKeyStore.read());
  }

  getCredentials(): OAuthCredentials | null {
    return this.credentials;
  }

  getApiKeyCredentials(): UserApiKeyCredentials | null {
    return this.apiKeyCredentials;
  }
  isApiKeyPersistent(): boolean {
    return this.apiKeyPersistent;
  }
}

const authManagerInstances = new Map<string, AuthManager>();

export function getAuthManager({
  targetScope = "mainnet",
  clientId = DEFAULT_OAUTH_CLIENT_ID,
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
