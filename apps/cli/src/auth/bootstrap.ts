import { CliError } from "../cli/errors.js";
import { loadCliEnvironment } from "../config/loader.js";
import {
  type AuthEnvironment,
  type AuthManager,
  envBearerCredential,
  getAuthManager,
} from "./auth-manager.js";
import {
  assertApiKeyTarget,
  type CliTargetConfig,
  MAINNET_API_URL,
  PREPROD_API_URL,
  resolveCliConfig,
  resolveTargetScope,
  sanitizeApiUrl,
  targetFromUserApiKey,
} from "./config.js";

type BootRoute = "boot" | "auth" | "signed-in";

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

interface BootstrapCliSessionOptions {
  environment?: AuthEnvironment;
  loadFiles?: boolean;
  preprod?: boolean;
  preprodDefault?: boolean;
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
    "preprod" | "preprodDefault" | "apiUrl" | "authUrl" | "clientId"
  >,
): CliTargetConfig {
  const detectedApiKeyTarget = targetFromUserApiKey(
    String(env.SOKOSUMI_API_KEY || ""),
  );
  const apiUrlFromKeyTarget =
    detectedApiKeyTarget === "preprod"
      ? PREPROD_API_URL
      : detectedApiKeyTarget === "mainnet"
        ? MAINNET_API_URL
        : undefined;
  const apiUrl =
    options.apiUrl ||
    (options.preprod
      ? PREPROD_API_URL
      : env.SOKOSUMI_API_URL ||
        apiUrlFromKeyTarget ||
        (options.preprodDefault ? PREPROD_API_URL : MAINNET_API_URL));
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
  preprodDefault,
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
    preprodDefault,
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

  // An environment token wins over stored credentials, so skip the OS vault.
  // Without one, check the stored key up front: requests fall back to it
  // when the OAuth session expires mid-run.
  const envBearer = envBearerCredential(environment);
  const storedApiKey = envBearer ? null : authManager.getApiKeyCredentials();
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
  const expiresAt = envBearer
    ? null
    : authMethod === "api-key"
      ? authManager.getApiKeyCredentials()?.expiresAt || null
      : authManager.getCredentials()?.expiresAt || null;

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
    throw new CliError(
      "AUTH_REQUIRED",
      session.config.target === "custom" && !session.config.clientId
        ? `Authentication required for this API URL. Sign in with \`sokosumi --api-url ${sanitizeApiUrl(session.config.apiUrl)} --client-id <id> auth login\`, or set SOKOSUMI_OAUTH_CLIENT_ID.`
        : AUTHENTICATION_REQUIRED_MESSAGE,
    );
  }
  return auth;
}
