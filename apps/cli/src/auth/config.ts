import { Buffer } from "node:buffer";

export type CliTarget = "mainnet" | "preprod" | "custom";

export type CliEnvironment = Readonly<Record<string, string | undefined>>;

export interface CliTargetConfig {
  target: CliTarget;
  apiUrl: string;
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
}

export const MAINNET_API_URL = "https://api.sokosumi.com";
export const PREPROD_API_URL = "https://api.preprod.sokosumi.com";
export const DEFAULT_OAUTH_CLIENT_ID = "sokosumi_cli";

export const USER_API_KEY_PREFIX_BY_TARGET: Readonly<
  Record<Exclude<CliTarget, "custom">, string>
> = {
  mainnet: "soko_mainnet_",
  preprod: "soko_preprod_",
};

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

function canonicalApiUrl(apiUrl: string): string {
  const normalized = trimUrl(apiUrl);
  try {
    return new URL(normalized).toString();
  } catch {
    return normalized;
  }
}

export function resolveTargetFromApiUrl(apiUrl: string): CliTarget {
  const normalized = trimUrl(apiUrl);
  if (normalized === MAINNET_API_URL) return "mainnet";
  if (normalized === PREPROD_API_URL) return "preprod";
  return "custom";
}

export function resolveTargetScope(target: CliTarget, apiUrl: string): string {
  if (target !== "custom") return target;
  return `custom-${Buffer.from(canonicalApiUrl(apiUrl), "utf8").toString("hex")}`;
}

export function targetFromUserApiKey(
  apiKey: string,
): Exclude<CliTarget, "custom"> | null {
  const value = apiKey.trim();
  for (const [target, prefix] of Object.entries(
    USER_API_KEY_PREFIX_BY_TARGET,
  )) {
    if (value.startsWith(prefix)) {
      return target as Exclude<CliTarget, "custom">;
    }
  }
  return null;
}

export function userApiKeyPrefixForTarget(target: CliTarget): string | null {
  return target === "custom" ? null : USER_API_KEY_PREFIX_BY_TARGET[target];
}

function resolveAuthBaseUrl(
  target: CliTarget,
  apiUrl: string,
  configuredAuthBaseUrl?: string,
): string {
  const defaultAuthBaseUrl = `${apiUrl}/auth`;
  if (target !== "custom") return defaultAuthBaseUrl;
  return trimUrl(configuredAuthBaseUrl || "") || defaultAuthBaseUrl;
}

export function resolveCliConfig({
  env = process.env,
  apiUrl,
  authBaseUrl,
  clientId,
  clientSecret,
  preprod = false,
}: {
  env?: CliEnvironment;
  apiUrl?: string;
  authBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  preprod?: boolean;
} = {}): CliTargetConfig {
  const resolvedApiUrl = trimUrl(
    apiUrl ||
      (preprod ? PREPROD_API_URL : undefined) ||
      env.SOKOSUMI_API_URL ||
      MAINNET_API_URL,
  );
  const target = resolveTargetFromApiUrl(resolvedApiUrl);
  const targetClientIdEnv =
    target === "preprod"
      ? env.SOKOSUMI_PREPROD_OAUTH_CLIENT_ID
      : target === "mainnet"
        ? env.SOKOSUMI_MAINNET_OAUTH_CLIENT_ID
        : undefined;
  const resolvedClientId = String(
    clientId ||
      targetClientIdEnv ||
      env.SOKOSUMI_OAUTH_CLIENT_ID ||
      (target === "custom" ? DEFAULT_OAUTH_CLIENT_ID : ""),
  ).trim();
  const resolvedAuthBaseUrl = resolveAuthBaseUrl(
    target,
    resolvedApiUrl,
    authBaseUrl || env.SOKOSUMI_AUTH_URL,
  );

  return {
    target,
    apiUrl: resolvedApiUrl,
    authBaseUrl: resolvedAuthBaseUrl,
    clientId: resolvedClientId,
    clientSecret: String(
      clientSecret || env.SOKOSUMI_OAUTH_CLIENT_SECRET || "",
    ).trim(),
  };
}
