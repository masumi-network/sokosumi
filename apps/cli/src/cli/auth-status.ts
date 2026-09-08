import { type AuthEnvironment, getAuthManager } from "../auth/auth-manager.js";
import { resolveInitialAuth } from "../auth/bootstrap.js";
import {
  type CliTargetConfig,
  resolveCliConfig,
  resolveTargetScope,
} from "../auth/config.js";

interface TextOutput {
  write(value: string): unknown;
}

interface AuthStatusManager {
  getApiKeyCredentials(): { apiKey: string; expiresAt?: string | null } | null;
  getAuthTokenAsync(options: {
    authBaseUrl: string;
    clientId: string;
    clientSecret?: string;
    environment: AuthEnvironment;
  }): Promise<string | null>;
  getAuthMethod(environment: AuthEnvironment): "oauth" | "api-key" | null;
  getCredentials(): { expiresAt?: string | null } | null;
}

export interface AuthStatusResult {
  authenticated: boolean;
  authMethod: "oauth" | "api-key" | null;
  apiKeyAvailable: boolean;
  target: CliTargetConfig["target"];
  apiUrl: string;
  expiresAt: string | null;
}

export async function runAuthStatus({
  env = process.env,
  config,
  authManager,
  stdout = process.stdout,
  json = false,
}: {
  env?: AuthEnvironment;
  config?: CliTargetConfig;
  authManager?: AuthStatusManager;
  stdout?: TextOutput;
  json?: boolean;
} = {}): Promise<AuthStatusResult> {
  const resolvedConfig = config || resolveCliConfig({ env });
  const manager =
    authManager ||
    getAuthManager({
      targetScope: resolveTargetScope(
        resolvedConfig.target,
        resolvedConfig.apiUrl,
      ),
      clientId: resolvedConfig.clientId,
      environment: env,
    });
  const auth = await resolveInitialAuth({
    authManager: manager,
    config: resolvedConfig,
    environment: env,
  });
  const result: AuthStatusResult = {
    authenticated: auth.authenticated,
    authMethod: auth.authMethod,
    apiKeyAvailable: Boolean(
      String(env.SOKOSUMI_API_KEY || "").trim() ||
        manager.getApiKeyCredentials()?.apiKey,
    ),
    target: resolvedConfig.target,
    apiUrl: resolvedConfig.apiUrl,
    expiresAt: auth.expiresAt,
  };
  if (json) {
    stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    stdout.write(
      `Authenticated: ${result.authenticated ? "yes" : "no"}\nMethod: ${result.authMethod || "none"}\nTarget: ${result.target}\nAPI URL: ${result.apiUrl}\nExpires: ${result.expiresAt || "unknown"}\n`,
    );
  }
  return result;
}
