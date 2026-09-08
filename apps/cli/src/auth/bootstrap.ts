import type { AuthEnvironment } from "./auth-manager.js";
import type { CliTargetConfig } from "./config.js";
import { targetFromUserApiKey } from "./config.js";

export type BootRoute = "boot" | "auth" | "signed-in";

export interface InitialAuthState {
  authenticated: boolean;
  authMethod: "oauth" | "api-key" | null;
  expiresAt: string | null;
}

export interface AuthBootstrapManager {
  getApiKeyCredentials(): {
    apiKey: string;
    target?: string;
    expiresAt?: string | null;
  } | null;
  getAuthTokenAsync(options: {
    authBaseUrl: string;
    clientId: string;
    clientSecret?: string;
    environment: AuthEnvironment;
  }): Promise<string | null>;
  getAuthMethod(environment: AuthEnvironment): "oauth" | "api-key" | null;
  getCredentials(): { expiresAt?: string | null } | null;
}

export function selectBootRoute({
  authResolved,
  hasAuth,
}: {
  authResolved: boolean;
  hasAuth: boolean;
}): BootRoute {
  if (!authResolved) return "boot";
  return hasAuth ? "signed-in" : "auth";
}

function assertApiKeyTarget(apiKey: string, config: CliTargetConfig): void {
  if (/\s/.test(apiKey)) {
    throw new Error("API key must not contain whitespace");
  }
  const detectedTarget = targetFromUserApiKey(apiKey);
  if (
    detectedTarget &&
    config.target !== "custom" &&
    detectedTarget !== config.target
  ) {
    throw new Error(
      `API key belongs to ${detectedTarget}, but the selected target is ${config.target}`,
    );
  }
}

export async function resolveInitialAuth({
  authManager,
  config,
  environment = process.env,
}: {
  authManager: AuthBootstrapManager;
  config: CliTargetConfig;
  environment?: AuthEnvironment;
}): Promise<InitialAuthState> {
  const envApiKey = String(environment.SOKOSUMI_API_KEY || "").trim();
  if (envApiKey) assertApiKeyTarget(envApiKey, config);

  const storedApiKey = authManager.getApiKeyCredentials();
  if (storedApiKey?.apiKey) {
    assertApiKeyTarget(storedApiKey.apiKey, config);
    if (storedApiKey.target && storedApiKey.target !== config.target) {
      throw new Error(
        `Stored API key belongs to ${storedApiKey.target}, but the selected target is ${config.target}`,
      );
    }
  }

  const token = await authManager.getAuthTokenAsync({
    authBaseUrl: config.authBaseUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret || undefined,
    environment,
  });
  const authMethod = authManager.getAuthMethod(environment);
  const credentials = authManager.getCredentials();
  const apiKeyCredentials = authManager.getApiKeyCredentials();
  const expiresAt =
    authMethod === "api-key"
      ? apiKeyCredentials?.expiresAt || null
      : credentials?.expiresAt || null;

  return {
    authenticated: Boolean(token),
    authMethod: token ? authMethod : null,
    expiresAt,
  };
}
