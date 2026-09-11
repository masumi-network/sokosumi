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
export const MAINNET_OAUTH_CLIENT_ID = "GxmewjdHVAaqUEglxWdyCqVFvnTASycj";
export const PREPROD_OAUTH_CLIENT_ID = "lqhckIfBGmFhBMyCkbhvUkXHiatZVXwR";
export const DEFAULT_OAUTH_CLIENT_ID = "sokosumi_cli";

const BUILT_IN_OAUTH_CLIENT_ID_BY_TARGET: Readonly<
  Record<Exclude<CliTarget, "custom">, string>
> = {
  mainnet: MAINNET_OAUTH_CLIENT_ID,
  preprod: PREPROD_OAUTH_CLIENT_ID,
};

function builtInOAuthClientIdForTarget(target: CliTarget): string {
  return target === "custom"
    ? DEFAULT_OAUTH_CLIENT_ID
    : BUILT_IN_OAUTH_CLIENT_ID_BY_TARGET[target];
}

export const USER_API_KEY_PREFIX_BY_TARGET: Readonly<
  Record<Exclude<CliTarget, "custom">, string>
> = {
  mainnet: "soko_mainnet_",
  preprod: "soko_preprod_",
};
export const WEB_API_KEY_ROUTE = "/connections";

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

const COMPOUND_CREDENTIAL_QUERY_KEYS = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "accesskey",
  "authorization",
  "bearer",
  "privatekey",
  "authkey",
  "signature",
  "jwt",
  "jwttoken",
  "idtoken",
] as const;

function isCredentialQueryKey(key: string): boolean {
  const parts = key
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
  const compact = parts.join("");
  return (
    parts.some((part) =>
      ["key", "password", "secret", "token"].includes(part),
    ) || COMPOUND_CREDENTIAL_QUERY_KEYS.some((name) => compact.includes(name))
  );
}

function sanitizeMalformedApiUrl(apiUrl: string): string {
  const withoutHash = apiUrl.split("#", 1)[0] || "";
  const withoutUserInfo = withoutHash.replace(/\/\/[^/@\s]+@/g, "//");
  const queryStart = withoutUserInfo.indexOf("?");
  if (queryStart < 0) return withoutUserInfo;

  const path = withoutUserInfo.slice(0, queryStart);
  const query = withoutUserInfo.slice(queryStart + 1);
  const keptParams = query.split("&").filter((parameter) => {
    const equals = parameter.indexOf("=");
    const rawKey = equals < 0 ? parameter : parameter.slice(0, equals);
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      // Keep malformed non-credential keys unchanged.
    }
    return !isCredentialQueryKey(key);
  });
  return keptParams.length > 0 ? `${path}?${keptParams.join("&")}` : path;
}

export function sanitizeApiUrl(apiUrl: string): string {
  const normalized = trimUrl(apiUrl);
  try {
    const url = new URL(normalized);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (isCredentialQueryKey(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return sanitizeMalformedApiUrl(normalized);
  }
}

function canonicalApiUrl(apiUrl: string): string {
  return sanitizeApiUrl(apiUrl);
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
      builtInOAuthClientIdForTarget(target),
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
