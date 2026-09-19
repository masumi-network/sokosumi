import {
  type CoreHttpClient,
  createCoreHttpClient,
} from "../api/http-client.js";
import {
  type AuthEnvironment,
  type AuthManager,
  getAuthManager,
} from "../auth/auth-manager.js";
import { resolveInitialAuth } from "../auth/bootstrap.js";
import {
  type CliTargetConfig,
  MAINNET_API_URL,
  PREPROD_API_URL,
  resolveCliConfig,
  resolveTargetScope,
  targetFromUserApiKey,
} from "../auth/config.js";
import { loadCliEnvironment } from "../config/loader.js";
import { redactErrorMessage } from "../error-redaction.js";
import { renderStatusApp, type StatusAppOptions } from "../tui/status-app.js";
import { type AuthLoginOptions, runAuthLogin } from "./auth-login.js";
import { runAuthLogout } from "./auth-logout.js";
import { runAuthStatus } from "./auth-status.js";
import { runAgentsCommand } from "./commands/agents.js";
import { runCoworkersCommand } from "./commands/coworkers.js";
import { CLI_COMMANDS, runDiscoverCommand } from "./commands/discover.js";
import { runJobsCommand } from "./commands/jobs.js";
import { runTasksCommand } from "./commands/tasks.js";
import { CLI_VERSION } from "./metadata.js";

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
  | "event-id"
  | "status"
  | "comment"
  | "agent"
  | "input-json"
  | "input-file"
  | "max-credits"
  | "vendor-id";

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
  "event-id"?: string;
  status?: CliOptionValue;
  comment?: string;
  agent?: string;
  "input-json"?: string;
  "input-file"?: string;
  "max-credits"?: string;
  "vendor-id"?: string;
  "api-key-stdin"?: boolean;
  "create-api-key"?: boolean;
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

const COMMAND_USAGE: Record<(typeof CLI_COMMANDS)[number], string> = {
  discover: "[--json]",
  "auth login": "[--json]",
  "auth status": "[--json]",
  "auth logout": "[--json]",
  "agents list": "[--search TEXT] [--limit N] [--json]",
  "agents hire": "AGENT_ID --input-json JSON [--max-credits N]",
  "coworkers list": "[--scope SCOPE] [--capability CAPABILITY]",
  "coworkers register": "[--vendor-id ID] [--create-api-key] [options]",
  "coworkers update": "COWORKER_ID [options]",
  "coworkers api-key": "COWORKER_ID [options]",
  "coworkers me": "",
  "tasks list": "[options]",
  "tasks create": "--coworker-id ID --description TEXT",
  "tasks get": "TASK_ID",
  "tasks events": "TASK_ID",
  "tasks jobs": "TASK_ID",
  "tasks comment": "TASK_ID [--comment TEXT] [--status STATUS]",
  "jobs list": "[--search TEXT] [--limit N]",
  "jobs get": "JOB_ID [--details]",
  "jobs input":
    "JOB_ID --event-id EVENT_ID [--input-json JSON|--input-file FILE]",
};

export const GLOBAL_VALUE_OPTIONS = [
  "api-url",
  "auth-url",
  "client-id",
  "oauth-port",
  "oauth-timeout-ms",
] as const satisfies readonly ValueOptionName[];

const GLOBAL_VALUE_PLACEHOLDERS: Record<
  (typeof GLOBAL_VALUE_OPTIONS)[number],
  string
> = {
  "api-url": "URL",
  "auth-url": "URL",
  "client-id": "ID",
  "oauth-port": "PORT",
  "oauth-timeout-ms": "MS",
};

export const GLOBAL_BOOLEAN_FLAG_BY_TOKEN = {
  "--preprod": "preprod",
  "--api-key-stdin": "api-key-stdin",
  "--json": "json",
  "-h": "help",
  "--help": "help",
  "-v": "version",
  "--version": "version",
} as const satisfies Record<string, keyof CliOptions>;

export const BOOLEAN_OPTION_NAMES = ["create-api-key", "details"] as const;

function formatGlobalOptionHelp(): string[] {
  const booleanLines: string[] = [];
  const seen = new Set<string>();
  for (const [token, option] of Object.entries(GLOBAL_BOOLEAN_FLAG_BY_TOKEN)) {
    if (seen.has(option)) {
      booleanLines[booleanLines.length - 1] += `, ${token}`;
      continue;
    }
    seen.add(option);
    booleanLines.push(token);
  }
  return [
    ...GLOBAL_VALUE_OPTIONS.map(
      (name) => `--${name} ${GLOBAL_VALUE_PLACEHOLDERS[name]}`,
    ),
    ...booleanLines,
  ];
}

function formatHelpText(): string {
  const usage = CLI_COMMANDS.map((command) => {
    const extra = COMMAND_USAGE[command];
    return extra ? `  sokosumi ${command} ${extra}` : `  sokosumi ${command}`;
  }).join("\n");
  return `Sokosumi CLI v${CLI_VERSION}

Usage:
  sokosumi
${usage}

Empty argv opens the TUI. Use arrows, then Enter. Press Esc to go back.

Global options:
${formatGlobalOptionHelp()
  .map((line) => `  ${line}`)
  .join("\n")}
`;
}

const VALUE_OPTIONS = new Set<ValueOptionName>([
  ...GLOBAL_VALUE_OPTIONS,
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
  "event-id",
  "status",
  "comment",
  "agent",
  "input-json",
  "input-file",
  "max-credits",
  "vendor-id",
]);

const REPEATED_VALUE_OPTIONS = new Set<ValueOptionName>([
  "capability",
  "channel",
  "status",
]);

const BOOLEAN_OPTIONS = new Set<string>(BOOLEAN_OPTION_NAMES);
const CORE_COMMAND_SECTIONS = new Set([
  "discover",
  "agents",
  "coworkers",
  "tasks",
  "jobs",
]);
interface ParsedArgv {
  positionals: string[];
  options: CliOptions;
}
export function parseArgv(argv: string[]): ParsedArgv {
  const positionals: string[] = [];
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (Object.hasOwn(GLOBAL_BOOLEAN_FLAG_BY_TOKEN, token)) {
      const optionName =
        GLOBAL_BOOLEAN_FLAG_BY_TOKEN[
          token as keyof typeof GLOBAL_BOOLEAN_FLAG_BY_TOKEN
        ];
      options[optionName] = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const optionToken = token.slice(2);
    const equalsIndex = optionToken.indexOf("=");
    const name =
      equalsIndex === -1 ? optionToken : optionToken.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : optionToken.slice(equalsIndex + 1);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (inlineValue !== undefined) {
        throw new Error(`Option --${name} does not accept a value`);
      }
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name as ValueOptionName)) {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = inlineValue === undefined ? argv[index + 1] : inlineValue;
    if (value === undefined || value === "" || value.startsWith("--")) {
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
    if (inlineValue === undefined) index += 1;
  }
  return { positionals, options };
}

function applyGlobalEnv(
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
      : env.SOKOSUMI_API_URL ||
        (detectedApiKeyTarget === "preprod"
          ? PREPROD_API_URL
          : MAINNET_API_URL));
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

function writeJsonError(
  stdout: TextOutput,
  error: unknown,
  environment?: AuthEnvironment,
): void {
  const knownSecrets = [
    environment?.SOKOSUMI_API_KEY,
    environment?.SOKOSUMI_AUTH_TOKEN,
    environment?.SOKOSUMI_OAUTH_CLIENT_SECRET,
  ].filter((secret): secret is string => Boolean(secret));
  const message = redactErrorMessage(error, knownSecrets);
  stdout.write(`${JSON.stringify({ error: message })}\n`);
}
export async function runCli(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  const stdout = dependencies.stdout || process.stdout;
  let parsed: ParsedArgv;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    if (argv.includes("--json")) writeJsonError(stdout, error);
    throw error;
  }
  const { positionals, options } = parsed;

  if (options.help) {
    stdout.write(formatHelpText());
    return { help: true };
  }
  if (options.version) {
    stdout.write(`${CLI_VERSION}\n`);
    return { version: CLI_VERSION };
  }

  let env: AuthEnvironment;
  let config: CliTargetConfig;
  try {
    env = applyGlobalEnv(
      loadCliEnvironment({
        environment: dependencies.env || process.env,
        loadFiles: dependencies.env === undefined,
      }),
      options,
    );
    config = resolveCommandConfig(env, options);
  } catch (error) {
    if (options.json)
      writeJsonError(stdout, error, dependencies.env || process.env);
    throw error;
  }
  const targetExplicit = Boolean(
    options.preprod || options["api-url"] || env.SOKOSUMI_API_URL,
  );

  try {
    if (positionals.length === 0) {
      const authManager = getManager(config, env, dependencies.authManager);
      const tuiFn = dependencies.tuiFn || renderStatusApp;
      return await tuiFn({
        authManager,
        coreClient: getCoreClient(config, env, dependencies),
        env,
        config,
        clientIdOverride: options["client-id"],
        targetExplicit,
        loginFn: dependencies.loginFn,
        oauthPort:
          options["oauth-port"] === undefined
            ? undefined
            : Number(options["oauth-port"]),
        oauthTimeoutMs:
          options["oauth-timeout-ms"] === undefined
            ? undefined
            : Number(options["oauth-timeout-ms"]),
      });
    }

    const [section, command, positionalId, ...rest] = positionals;
    if (rest.length > 0) {
      throw new Error(`Unexpected argument: ${rest[0]}`);
    }
    if (CORE_COMMAND_SECTIONS.has(section)) {
      const auth = await resolveInitialAuth({
        authManager: getManager(config, env, dependencies.authManager),
        config,
        environment: env,
        targetExplicit,
      });
      if (!auth.authenticated) {
        throw new Error(
          "Authentication required. Run `sokosumi auth login` first.",
        );
      }
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
        ["list", "create", "get", "events", "jobs", "comment"].includes(
          command,
        ))
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
      (command === undefined || ["list", "get", "input"].includes(command))
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
      return await runAuthLogout({
        env,
        config,
        authManager: dependencies.authManager,
        stdout,
        json: options.json,
      });
    }
    if (command === "status") {
      return await runAuthStatus({
        env,
        config,
        authManager: dependencies.authManager,
        stdout,
        json: options.json,
        targetExplicit,
      });
    }

    return await runAuthLogin({
      ...dependencies,
      env,
      config,
      targetExplicit,
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
  } catch (error) {
    if (options.json) writeJsonError(stdout, error, env);
    throw error;
  }
}
