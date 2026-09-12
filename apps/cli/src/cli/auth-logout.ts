import { type AuthEnvironment, getAuthManager } from "../auth/auth-manager.js";
import {
  type CliTargetConfig,
  resolveCliConfig,
  resolveTargetScope,
} from "../auth/config.js";

interface TextOutput {
  write(value: string): unknown;
}

interface AuthLogoutManager {
  logout(): void;
}

export interface AuthLogoutResult {
  authenticated: false;
}
export async function runAuthLogout({
  env = process.env,
  config,
  authManager,
  stdout = process.stdout,
  json = false,
}: {
  env?: AuthEnvironment;
  config?: CliTargetConfig;
  authManager?: AuthLogoutManager;
  stdout?: TextOutput;
  json?: boolean;
} = {}): Promise<AuthLogoutResult> {
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
  manager.logout();
  const result: AuthLogoutResult = { authenticated: false };
  if (json) {
    stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    stdout.write("Signed out.\n");
  }
  return result;
}
