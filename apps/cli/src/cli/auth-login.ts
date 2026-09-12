import { readFileSync } from "node:fs";

import {
  type AuthEnvironment,
  getAuthManager,
  type OAuthCredentials,
} from "../auth/auth-manager.js";
import {
  type CliTargetConfig,
  resolveCliConfig,
  resolveTargetScope,
  sanitizeApiUrl,
  targetFromUserApiKey,
} from "../auth/config.js";
import { type BrowserLoginOptions, loginWithBrowser } from "../auth/oauth.js";

interface TextOutput {
  write(value: string): unknown;
}

export interface AuthLoginResult {
  authenticated: true;
  authMethod: "oauth" | "api-key";
  apiKeyAvailable: boolean;
  target: CliTargetConfig["target"];
  apiUrl: string;
  expiresAt: string | null;
}

export interface AuthLoginManager {
  saveCredentials(credentials: OAuthCredentials): OAuthCredentials;
  saveApiKey?(credentials: {
    apiKey: string;
    target: CliTargetConfig["target"];
  }): unknown;
  getApiKeyCredentials?(): { apiKey: string } | null;
}

export interface AuthLoginOptions {
  env?: AuthEnvironment;
  config?: CliTargetConfig;
  targetExplicit?: boolean;
  authBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  port?: number;
  callbackPath?: string;
  timeoutMs?: number;
  json?: boolean;
  apiKey?: string;
  apiKeyStdin?: boolean;
  readStdin?: () => string;
  loginFn?: (options: BrowserLoginOptions) => Promise<OAuthCredentials>;
  authManager?: AuthLoginManager;
  stdout?: TextOutput;
  signal?: AbortSignal;
}

export function resolveAuthBaseUrl(env: AuthEnvironment): string {
  return resolveCliConfig({ env }).authBaseUrl;
}

function writeResult(
  stdout: TextOutput,
  result: AuthLoginResult,
  json: boolean,
): void {
  if (json) {
    stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const label = result.authMethod === "api-key" ? "API key" : "OAuth";
  stdout.write(
    `${label} login complete for ${result.target}. Token expires: ${result.expiresAt || "unknown"}\n`,
  );
}

function readApiKeyFromStdin(readStdin: () => string): string {
  const apiKey = readStdin().trim();
  if (!apiKey) throw new Error("API key stdin input was empty");
  return apiKey;
}

const COWORKER_API_KEY_PREFIX = "coworker_";

function validateApiKeyTarget(
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

function defaultReadStdin(): string {
  return readFileSync(0, "utf8");
}

export async function runAuthLogin({
  env = process.env,
  config,
  targetExplicit = false,
  authBaseUrl,
  clientId,
  clientSecret,
  port,
  callbackPath,
  timeoutMs,
  json = false,
  apiKey,
  apiKeyStdin = false,
  readStdin = defaultReadStdin,
  loginFn = loginWithBrowser,
  authManager,
  stdout = process.stdout,
  signal,
}: AuthLoginOptions = {}): Promise<AuthLoginResult> {
  let resolvedConfig =
    config ||
    resolveCliConfig({
      env,
      authBaseUrl,
      clientId,
      clientSecret,
    });
  const providedApiKey =
    apiKey ||
    (apiKeyStdin ? readApiKeyFromStdin(readStdin) : "") ||
    env.SOKOSUMI_API_KEY;
  const detectedApiKeyTarget = targetFromUserApiKey(
    String(providedApiKey || ""),
  );
  const targetRoutedFromApiKey =
    Boolean(detectedApiKeyTarget) &&
    !targetExplicit &&
    !env.SOKOSUMI_API_URL &&
    detectedApiKeyTarget !== resolvedConfig.target;
  if (targetRoutedFromApiKey && detectedApiKeyTarget) {
    resolvedConfig = resolveCliConfig({
      env,
      authBaseUrl,
      clientId,
      clientSecret,
      preprod: detectedApiKeyTarget === "preprod",
    });
  }
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

  if (providedApiKey?.trim()) {
    const normalizedApiKey = providedApiKey.trim();
    validateApiKeyTarget(normalizedApiKey, resolvedConfig, targetExplicit);
    if (!manager.saveApiKey) {
      throw new Error("API-key credential storage is unavailable");
    }
    manager.saveApiKey({
      apiKey: normalizedApiKey,
      target: resolvedConfig.target,
    });
    const result: AuthLoginResult = {
      authenticated: true,
      authMethod: "api-key",
      apiKeyAvailable: true,
      target: resolvedConfig.target,
      apiUrl: sanitizeApiUrl(resolvedConfig.apiUrl),
      expiresAt: null,
    };
    writeResult(stdout, result, json);
    return result;
  }

  const loginRequest: BrowserLoginOptions = {
    authBaseUrl: resolvedConfig.authBaseUrl,
    clientId: clientId || resolvedConfig.clientId,
    ...(clientSecret || resolvedConfig.clientSecret
      ? { clientSecret: clientSecret || resolvedConfig.clientSecret }
      : {}),
    ...(port === undefined ? {} : { port }),
    ...(callbackPath === undefined ? {} : { callbackPath }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  };
  const credentials = await loginFn(loginRequest);
  if (signal?.aborted) {
    throw new Error("OAuth login was cancelled");
  }
  manager.saveCredentials(credentials);

  const result: AuthLoginResult = {
    authenticated: true,
    authMethod: "oauth",
    apiKeyAvailable: Boolean(manager.getApiKeyCredentials?.()),
    target: resolvedConfig.target,
    apiUrl: sanitizeApiUrl(resolvedConfig.apiUrl),
    expiresAt: credentials.expiresAt || null,
  };
  writeResult(stdout, result, json);
  return result;
}
