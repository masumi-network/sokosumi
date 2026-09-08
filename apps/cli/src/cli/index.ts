import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  type CoreHttpClient,
  createCoreHttpClient,
} from "../api/http-client.js";
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
import { loadCliEnvironment } from "../config/loader.js";
import { renderStatusApp, type StatusAppOptions } from "../tui/status-app.js";
import { type AuthLoginOptions, runAuthLogin } from "./auth-login.js";
import { runAuthLogout } from "./auth-logout.js";
import { runAuthStatus } from "./auth-status.js";
import { runAgentsCommand } from "./commands/agents.js";
import { runCoworkersCommand } from "./commands/coworkers.js";
import { runDiscoverCommand } from "./commands/discover.js";
import { runJobsCommand } from "./commands/jobs.js";
import { runTasksCommand } from "./commands/tasks.js";

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
  | "oauth-timeout-ms"
  | "search"
  | "limit"
  | "scope"
  | "capability"
  | "capabilities"
  | "channel"
  | "id"
  | "q"
  | "metadata-json"
  | "metadata-file"
  | "name"
  | "caption"
  | "company"
  | "company-logo"
  | "url"
  | "base-url"
  | "description"
  | "image"
  | "priority"
  | "api-key-name"
  | "api-key-expires-at"
  | "expires-at"
  | "coworker-id"
  | "status"
  | "comment"
  | "agent"
  | "input-json"
  | "input-file"
  | "max-credits";

type CliOptionValue = string | string[];

interface CliOptions {
  [key: string]: string | string[] | boolean | undefined;
  json?: boolean;
  preprod?: boolean;
  help?: boolean;
  version?: boolean;
  "auth-url"?: string;
  "api-url"?: string;
  "client-id"?: string;
  "oauth-port"?: string;
  "oauth-timeout-ms"?: string;
  search?: string;
  limit?: string;
  scope?: string;
  capability?: CliOptionValue;
  capabilities?: CliOptionValue;
  channel?: CliOptionValue;
  id?: string;
  q?: string;
  "metadata-json"?: string;
  "metadata-file"?: string;
  name?: string;
  caption?: string;
  company?: string;
  "company-logo"?: string;
  url?: string;
  "base-url"?: string;
  description?: string;
  image?: string;
  priority?: string;
  "api-key-name"?: string;
  "api-key-expires-at"?: string;
  "expires-at"?: string;
  "coworker-id"?: string;
  status?: CliOptionValue;
  comment?: string;
  agent?: string;
  "input-json"?: string;
  "input-file"?: string;
  "max-credits"?: string;
  "api-key-stdin"?: boolean;
  "create-api-key"?: boolean;
  "with-api-key"?: boolean;
  details?: boolean;
}

export interface CliDependencies {
  env?: AuthEnvironment;
  stdout?: TextOutput;
  tuiFn?: (options: StatusAppOptions) => Promise<CliResult> | CliResult;
  authManager?: AuthManager;
  coreClient?: CoreHttpClient;
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
  sokosumi discover [--json]
  sokosumi auth login [--json]
  sokosumi auth status [--json]
  sokosumi auth logout [--json]
  sokosumi agents list [--search TEXT] [--limit N] [--json]
  sokosumi agents hire AGENT_ID --input-json JSON [--max-credits N]
  sokosumi coworkers list [--scope SCOPE] [--capability CAPABILITY]
  sokosumi coworkers register [options]
  sokosumi coworkers update COWORKER_ID [options]
  sokosumi coworkers api-key COWORKER_ID [options]
  sokosumi coworkers me
  sokosumi tasks list [options]
  sokosumi tasks create --coworker-id ID --description TEXT
  sokosumi tasks get TASK_ID
  sokosumi tasks events TASK_ID
  sokosumi tasks jobs TASK_ID
  sokosumi tasks comment TASK_ID [--comment TEXT] [--status STATUS]
  sokosumi jobs list [--search TEXT] [--limit N]
  sokosumi jobs get JOB_ID [--details]

Empty argv opens the TUI. Use arrows, then Enter. Press Esc to go back.

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

const VALUE_OPTIONS = new Set<ValueOptionName>([
  "auth-url",
  "api-url",
  "client-id",
  "oauth-port",
  "oauth-timeout-ms",
  "search",
  "limit",
  "scope",
  "capability",
  "capabilities",
  "channel",
  "id",
  "q",
  "metadata-json",
  "metadata-file",
  "name",
  "caption",
  "company",
  "company-logo",
  "url",
  "base-url",
  "description",
  "image",
  "priority",
  "api-key-name",
  "api-key-expires-at",
  "expires-at",
  "coworker-id",
  "status",
  "comment",
  "agent",
  "input-json",
  "input-file",
  "max-credits",
]);

const REPEATED_VALUE_OPTIONS = new Set<ValueOptionName>([
  "capability",
  "channel",
  "status",
]);

const BOOLEAN_OPTIONS = new Set(["create-api-key", "with-api-key", "details"]);
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
    if (BOOLEAN_OPTIONS.has(name)) {
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name as ValueOptionName)) {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${name} requires a value`);
    }
    const optionName = name as ValueOptionName;
    const optionMap = options as Record<
      string,
      CliOptionValue | boolean | undefined
    >;
    const previous = optionMap[optionName];
    if (REPEATED_VALUE_OPTIONS.has(optionName) && previous !== undefined) {
      const values = Array.isArray(previous)
        ? previous
        : typeof previous === "string"
          ? [previous]
          : [];
      optionMap[optionName] = [...values, value];
    } else {
      optionMap[optionName] = value;
    }
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

function getCoreClient(
  config: CliTargetConfig,
  env: AuthEnvironment,
  dependencies: CliDependencies,
): CoreHttpClient {
  const manager = getManager(config, env, dependencies.authManager);
  return (
    dependencies.coreClient ||
    createCoreHttpClient({
      apiUrl: config.apiUrl,
      authManager: manager,
      authBaseUrl: config.authBaseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
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

  const env = applyGlobalEnv(
    loadCliEnvironment({
      environment: dependencies.env || process.env,
      loadFiles: dependencies.env === undefined,
    }),
    options,
  );
  const config = resolveCommandConfig(env, options);

  if (positionals.length === 0) {
    const authManager = getManager(config, env, dependencies.authManager);
    const tuiFn = dependencies.tuiFn || renderStatusApp;
    return tuiFn({
      authManager,
      coreClient: getCoreClient(config, env, dependencies),
      env,
      config,
      loginFn: dependencies.loginFn,
      readStdin: dependencies.readStdin,
    });
  }

  const [section, command, positionalId, ...rest] = positionals;
  if (rest.length > 0) {
    throw new Error(`Unexpected argument: ${rest[0]}`);
  }
  if (section === "discover" && command === undefined) {
    await runDiscoverCommand({
      client: getCoreClient(config, env, dependencies),
      config,
      stdout,
      json: options.json,
    });
    return {};
  }
  if (
    section === "agents" &&
    (command === undefined || command === "list" || command === "hire")
  ) {
    await runAgentsCommand({
      client: getCoreClient(config, env, dependencies),
      stdout,
      json: options.json,
      subcommand: command,
      positionalId,
      options,
    });
    return {};
  }
  if (
    section === "coworkers" &&
    (command === undefined ||
      ["list", "register", "update", "api-key", "me"].includes(command))
  ) {
    await runCoworkersCommand({
      client: getCoreClient(config, env, dependencies),
      stdout,
      json: options.json,
      subcommand: command,
      positionalId,
      options,
    });
    return {};
  }
  if (
    section === "tasks" &&
    (command === undefined ||
      ["list", "create", "get", "events", "jobs", "comment"].includes(command))
  ) {
    await runTasksCommand({
      client: getCoreClient(config, env, dependencies),
      stdout,
      json: options.json,
      subcommand: command,
      positionalId,
      options,
    });
    return {};
  }
  if (
    section === "jobs" &&
    (command === undefined || ["list", "get"].includes(command))
  ) {
    await runJobsCommand({
      client: getCoreClient(config, env, dependencies),
      stdout,
      json: options.json,
      subcommand: command,
      positionalId,
      options,
    });
    return {};
  }
  if (
    section !== "auth" ||
    (command !== "login" && command !== "logout" && command !== "status") ||
    positionalId !== undefined
  ) {
    throw new Error(
      "Usage: sokosumi discover | agents list | coworkers | tasks | jobs | auth login|status|logout",
    );
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
