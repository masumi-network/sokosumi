import type { CoreHttpClient } from "../api/http-client.js";
import { type AuthEnvironment } from "../auth/auth-manager.js";
import {
  type CliTargetConfig,
  MAINNET_API_URL,
  PREPROD_API_URL,
  resolveCliConfig,
  sanitizeApiUrl,
} from "../auth/config.js";

export type HostedTarget = "mainnet" | "preprod";

export function resolveHostedTargetConfig(
  env: AuthEnvironment,
  target: HostedTarget,
  overrides: Partial<Pick<CliTargetConfig, "clientId">> = {},
): CliTargetConfig {
  return resolveCliConfig({
    env,
    apiUrl: target === "preprod" ? PREPROD_API_URL : MAINNET_API_URL,
    preprod: target === "preprod",
    ...overrides,
  });
}

export function displayTargetLabel(config: CliTargetConfig): string {
  if (config.target !== "custom") return config.target;
  return sanitizeApiUrl(config.apiUrl);
}

function resolveSelectedHostedTarget(config: CliTargetConfig): HostedTarget {
  return config.target === "preprod" ? "preprod" : "mainnet";
}

export function isNetworkSelectionLocked(
  config: CliTargetConfig,
  options: { preprod?: boolean; apiUrl?: string } = {},
): boolean {
  return Boolean(
    options.preprod || options.apiUrl || config.target === "custom",
  );
}

export function toggleHostedTarget(target: HostedTarget): HostedTarget {
  return target === "mainnet" ? "preprod" : "mainnet";
}

export function canToggleSignInNetwork(options: {
  route: "boot" | "auth" | "signed-in";
  screen: string;
  networkSelectionLocked: boolean;
  busy: boolean;
}): boolean {
  return (
    options.route === "auth" &&
    options.screen === "auth-method" &&
    !options.networkSelectionLocked &&
    !options.busy
  );
}

export function nextSignInNetworkConfig(
  selectedConfig: CliTargetConfig,
  env: AuthEnvironment,
  clientIdOverride?: string,
): CliTargetConfig {
  return createTargetConfig(
    env,
    toggleHostedTarget(resolveSelectedHostedTarget(selectedConfig)),
    clientIdOverride,
  );
}

export function createTargetConfig(
  env: AuthEnvironment,
  target: HostedTarget,
  clientIdOverride?: string,
): CliTargetConfig {
  return resolveHostedTargetConfig(
    env,
    target,
    clientIdOverride ? { clientId: clientIdOverride } : {},
  );
}

export function resolveStatusCoreClient(options: {
  coreClientOverride?: CoreHttpClient;
  selectedApiUrl: string;
  configApiUrl: string;
  createClient: () => CoreHttpClient;
}): CoreHttpClient {
  if (
    options.coreClientOverride !== undefined &&
    options.selectedApiUrl === options.configApiUrl
  ) {
    return options.coreClientOverride;
  }
  return options.createClient();
}
