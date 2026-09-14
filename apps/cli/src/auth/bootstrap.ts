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

const COWORKER_API_KEY_PREFIX = "coworker_";

function assertApiKeyTarget(
  apiKey: string,
  config: CliTargetConfig,
  targetExplicit: boolean,
): void {
  if (/\s/.test(apiKey)) {
    throw new Error("API key must not contain whitespace");
  }
  if (apiKey.startsWith(COWORKER_API_KEY_PREFIX)) {
    throw new Error("Coworker API keys are not supported by the CLI");
  }
  const detectedTarget = targetFromUserApiKey(apiKey);
  if (!detectedTarget && !targetExplicit) {
    throw new Error(
      "Legacy API keys need an explicit target. Use --preprod or --api-url.",
    );
  }
  if (
    detectedTarget &&
    ((config.target === "custom" && targetExplicit) ||
      (config.target !== "custom" && detectedTarget !== config.target))
  ) {
    throw new Error(
      config.target === "custom" && targetExplicit
        ? `API key belongs to ${detectedTarget}, but the explicit target is ${config.target}.`
        : `API key belongs to ${detectedTarget}, but the selected target is ${config.target}`,
    );
  }
}

export async function resolveInitialAuth({
  authManager,
  config,
  environment = process.env,
  targetExplicit = false,
}: {
  authManager: AuthBootstrapManager;
  config: CliTargetConfig;
  environment?: AuthEnvironment;
  targetExplicit?: boolean;
}): Promise<InitialAuthState> {
  const envApiKey = String(environment.SOKOSUMI_API_KEY || "").trim();
  if (envApiKey) assertApiKeyTarget(envApiKey, config, targetExplicit);

  const storedApiKey = authManager.getApiKeyCredentials();
  if (storedApiKey?.apiKey) {
    assertApiKeyTarget(storedApiKey.apiKey, config, targetExplicit);
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
