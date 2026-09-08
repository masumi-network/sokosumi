import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  type AuthEnvironment,
  type AuthManager,
  getAuthManager,
} from "../auth/auth-manager.js";
import {
  type CliTargetConfig,
  MAINNET_API_URL,
  PREPROD_API_URL,
  resolveCliConfig,
  resolveTargetScope,
  targetFromUserApiKey,
} from "../auth/config.js";
import { renderStatusApp, type StatusAppOptions } from "../tui/status-app.js";
import { type AuthLoginOptions, runAuthLogin } from "./auth-login.js";
import { runAuthLogout } from "./auth-logout.js";
import { runAuthStatus } from "./auth-status.js";

const require = createRequire(import.meta.url);

function loadCliVersion(): string {
  const packageUrls = [
    new URL("../../package.json", import.meta.url),
    new URL("../../../package.json", import.meta.url),
  ];
  for (const packageUrl of packageUrls) {
    try {
      const packageJson = require(fileURLToPath(packageUrl)) as {
        version?: unknown;
      };
      if (typeof packageJson.version === "string") return packageJson.version;
    } catch {
      continue;
    }
  }
  throw new Error("Could not load the CLI package version");
}

const CLI_VERSION = loadCliVersion();

interface TextOutput {
  write(value: string): unknown;
}

type ValueOptionName =
  | "auth-url"
  | "api-url"
  | "client-id"
  | "oauth-port"
  | "oauth-timeout-ms";

interface CliOptions {
  json?: boolean;
  preprod?: boolean;
  help?: boolean;
  version?: boolean;
  "auth-url"?: string;
  "api-url"?: string;
  "client-id"?: string;
  "oauth-port"?: string;
  "oauth-timeout-ms"?: string;
  "api-key-stdin"?: boolean;
}

export interface CliDependencies {
  env?: AuthEnvironment;
  stdout?: TextOutput;
  tuiFn?: (options: StatusAppOptions) => Promise<CliResult> | CliResult;
  authManager?: AuthManager;
  loginFn?: AuthLoginOptions["loginFn"];
  readStdin?: () => string;
}

export interface CliResult {
  help?: true;
  version?: string;
  authenticated?: boolean;
  authMethod?: "oauth" | "api-key" | null;
  apiKeyAvailable?: boolean;
  target?: CliTargetConfig["target"];
  apiUrl?: string;
  expiresAt?: string | null;
  tui?: boolean;
}

const HELP_TEXT = `Sokosumi CLI v${CLI_VERSION}

Usage:
  sokosumi
  sokosumi auth login [--json]
  sokosumi auth status [--json]
  sokosumi auth logout [--json]

Empty argv opens the TUI. Choose browser OAuth or a user API key, then register a
Coworker runtime (pi-sokosumi, Eve, Hermes, OpenClaw).

Global options:
  --api-url URL
  --auth-url URL
  --client-id ID
  --preprod
  --api-key-stdin
  --json
  -h, --help
  -v, --version
`;

const VALUE_OPTIONS = new Set([
  "auth-url",
  "api-url",
  "client-id",
  "oauth-port",
  "oauth-timeout-ms",
]);

export function parseArgv(argv: string[]): {
  positionals: string[];
  options: CliOptions;
} {
  const positionals: string[] = [];
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--api-key-stdin") {
      options["api-key-stdin"] = true;
      continue;
    }
    if (token === "--preprod") {
      options.preprod = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      options.version = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const name = token.slice(2);
    if (!VALUE_OPTIONS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${name} requires a value`);
    }
    options[name as ValueOptionName] = value;
    index += 1;
  }
  return { positionals, options };
}

export function applyGlobalEnv(
  env: AuthEnvironment,
  options: CliOptions,
): AuthEnvironment {
  const next: Record<string, string | undefined> = { ...env };
  if (options.preprod) next.SOKOSUMI_API_URL = PREPROD_API_URL;
  if (options["api-url"]) next.SOKOSUMI_API_URL = options["api-url"];
  return next;
}

function resolveCommandConfig(
  env: AuthEnvironment,
  options: CliOptions,
): CliTargetConfig {
  const detectedApiKeyTarget = targetFromUserApiKey(
    String(env.SOKOSUMI_API_KEY || ""),
  );
  const explicitApiUrl = options["api-url"];
  const apiUrl =
    explicitApiUrl ||
    (options.preprod
      ? PREPROD_API_URL
      : detectedApiKeyTarget === "preprod"
        ? PREPROD_API_URL
        : env.SOKOSUMI_API_URL || MAINNET_API_URL);
  return resolveCliConfig({
    env,
    apiUrl,
    authBaseUrl: options["auth-url"],
    clientId: options["client-id"],
    preprod: options.preprod,
  });
}

function getManager(
  config: CliTargetConfig,
  env: AuthEnvironment,
  authManager?: AuthManager,
): AuthManager {
  return (
    authManager ||
    getAuthManager({
      targetScope: resolveTargetScope(config.target, config.apiUrl),
      clientId: config.clientId,
      environment: env,
    })
  );
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  const { positionals, options } = parseArgv(argv);
  const stdout = dependencies.stdout || process.stdout;

  if (options.help) {
    stdout.write(HELP_TEXT);
    return { help: true };
  }
  if (options.version) {
    stdout.write(`${CLI_VERSION}\n`);
    return { version: CLI_VERSION };
  }

  const env = applyGlobalEnv(dependencies.env || process.env, options);
  const config = resolveCommandConfig(env, options);

  if (positionals.length === 0) {
    const authManager = getManager(config, env, dependencies.authManager);
    const tuiFn = dependencies.tuiFn || renderStatusApp;
    return tuiFn({
      authManager,
      env,
      config,
      loginFn: dependencies.loginFn,
      readStdin: dependencies.readStdin,
    });
  }

  const [section, command, ...rest] = positionals;
  if (rest.length > 0) {
    throw new Error(`Unexpected argument: ${rest[0]}`);
  }
  if (
    section !== "auth" ||
    (command !== "login" && command !== "logout" && command !== "status")
  ) {
    throw new Error("Usage: sokosumi auth login|status|logout [--json]");
  }

  if (command === "logout") {
    return runAuthLogout({
      env,
      config,
      authManager: dependencies.authManager,
      stdout,
      json: options.json,
    });
  }
  if (command === "status") {
    return runAuthStatus({
      env,
      config,
      authManager: dependencies.authManager,
      stdout,
      json: options.json,
    });
  }

  return runAuthLogin({
    ...dependencies,
    env,
    config,
    targetExplicit: Boolean(
      options.preprod || options["api-url"] || env.SOKOSUMI_API_URL,
    ),
    authBaseUrl: options["auth-url"],
    clientId: options["client-id"],
    port:
      options["oauth-port"] === undefined
        ? undefined
        : Number(options["oauth-port"]),
    timeoutMs:
      options["oauth-timeout-ms"] === undefined
        ? undefined
        : Number(options["oauth-timeout-ms"]),
    apiKeyStdin: options["api-key-stdin"],
    json: options.json,
    authManager: dependencies.authManager,
    stdout,
  });
}
