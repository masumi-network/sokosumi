import { loadCliEnvironment } from "../config/loader.js";
import {
  type AuthEnvironment,
  type AuthManager,
  getAuthManager,
} from "./auth-manager.js";
import {
  assertApiKeyTarget,
  type CliTargetConfig,
  MAINNET_API_URL,
  PREPROD_API_URL,
  resolveCliConfig,
  resolveTargetScope,
  targetFromUserApiKey,
} from "./config.js";

export type BootRoute = "boot" | "auth" | "signed-in";

export const AUTHENTICATION_REQUIRED_MESSAGE =
  "Authentication required. Run `sokosumi auth login` first.";

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

export type AuthManagerFactory = (options: {
  targetScope: string;
  clientId: string;
  environment: AuthEnvironment;
}) => AuthManager;

export interface CliSession {
  env: AuthEnvironment;
  config: CliTargetConfig;
  targetExplicit: boolean;
  authManager: AuthManager;
}

export interface BootstrapCliSessionOptions {
  environment?: AuthEnvironment;
  loadFiles?: boolean;
  preprod?: boolean;
  apiUrl?: string;
  authUrl?: string;
  clientId?: string;
  authManager?: AuthManager;
  authManagerFactory?: AuthManagerFactory;
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

function applyGlobalEnv(
  env: AuthEnvironment,
  options: Pick<BootstrapCliSessionOptions, "preprod" | "apiUrl">,
): AuthEnvironment {
  const next: Record<string, string | undefined> = { ...env };
  if (options.preprod) next.SOKOSUMI_API_URL = PREPROD_API_URL;
  if (options.apiUrl) next.SOKOSUMI_API_URL = options.apiUrl;
  return next;
}

function resolveSessionConfig(
  env: AuthEnvironment,
  options: Pick<
    BootstrapCliSessionOptions,
    "preprod" | "apiUrl" | "authUrl" | "clientId"
  >,
): CliTargetConfig {
  const detectedApiKeyTarget = targetFromUserApiKey(
    String(env.SOKOSUMI_API_KEY || ""),
  );
  const apiUrl =
    options.apiUrl ||
    (options.preprod
      ? PREPROD_API_URL
      : env.SOKOSUMI_API_URL ||
        (detectedApiKeyTarget === "preprod"
          ? PREPROD_API_URL
          : MAINNET_API_URL));
  return resolveCliConfig({
    env,
    apiUrl,
    authBaseUrl: options.authUrl,
    clientId: options.clientId,
    preprod: options.preprod,
  });
}

export function createSessionAuthManager({
  config,
  environment,
  authManager,
  authManagerFactory = getAuthManager,
}: {
  config: CliTargetConfig;
  environment: AuthEnvironment;
  authManager?: AuthManager;
  authManagerFactory?: AuthManagerFactory;
}): AuthManager {
  return (
    authManager ||
    authManagerFactory({
      targetScope: resolveTargetScope(config.target, config.apiUrl),
      clientId: config.clientId,
      environment,
    })
  );
}

export function bootstrapCliSession({
  environment = process.env,
  loadFiles = true,
  preprod,
  apiUrl,
  authUrl,
  clientId,
  authManager,
  authManagerFactory,
}: BootstrapCliSessionOptions = {}): CliSession {
  const env = applyGlobalEnv(loadCliEnvironment({ environment, loadFiles }), {
    preprod,
    apiUrl,
  });
  const config = resolveSessionConfig(env, {
    preprod,
    apiUrl,
    authUrl,
    clientId,
  });
  return {
    env,
    config,
    targetExplicit: Boolean(preprod || apiUrl || env.SOKOSUMI_API_URL),
    authManager: createSessionAuthManager({
      config,
      environment: env,
      authManager,
      authManagerFactory,
    }),
  };
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

export async function requireAuthenticatedSession(session: {
  authManager: AuthBootstrapManager;
  config: CliTargetConfig;
  env: AuthEnvironment;
  targetExplicit: boolean;
}): Promise<InitialAuthState> {
  const auth = await resolveInitialAuth({
    authManager: session.authManager,
    config: session.config,
    environment: session.env,
    targetExplicit: session.targetExplicit,
  });
  if (!auth.authenticated) {
    throw new Error(AUTHENTICATION_REQUIRED_MESSAGE);
  }
  return auth;
}
