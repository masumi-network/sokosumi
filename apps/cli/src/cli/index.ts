import {
  type CoreHttpClient,
  createCoreHttpClient,
  validateOrganizationSlug,
} from "../api/http-client.js";
import {
  type AuthEnvironment,
  type AuthManager,
} from "../auth/auth-manager.js";
import {
  bootstrapCliSession,
  type CliSession,
  requireAuthenticatedSession,
} from "../auth/bootstrap.js";
import { type CliTargetConfig } from "../auth/config.js";
import { redactErrorMessage } from "../error-redaction.js";
import {
  isNetworkSelectionLocked,
  renderStatusApp,
  type StatusAppOptions,
} from "../tui/status-app.js";
import { type AuthLoginOptions, runAuthLogin } from "./auth-login.js";
import { runAuthLogout } from "./auth-logout.js";
import { runAuthStatus } from "./auth-status.js";
import { type AuthWhoamiResult, runAuthWhoami } from "./auth-whoami.js";
import { runAdminCommand, validateAdminCommand } from "./commands/admin.js";
import { runAgentsCommand } from "./commands/agents.js";
import type { CommandOutput } from "./commands/command-helpers.js";
import { runCoworkersCommand } from "./commands/coworkers.js";
import {
  CLI_COMMAND_CATALOG,
  formatUnknownCommandUsage,
  runDiscoverCommand,
} from "./commands/discover.js";
import { runJobsCommand } from "./commands/jobs.js";
import {
  type RuntimeDependencies,
  runRuntimeCommand,
} from "./commands/runtime.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runTasksCommand } from "./commands/tasks.js";
import { runVendorsCommand } from "./commands/vendors.js";
import { runWorkspacesCommand } from "./commands/workspaces.js";
import { buildJsonError, CliError } from "./errors.js";
import {
  type CliOptions,
  formatHelpText,
  GLOBAL_BOOLEAN_FLAG_BY_TOKEN,
  GLOBAL_VALUE_OPTIONS,
  type ValueOptionName,
} from "./help.js";
import { CLI_VERSION } from "./metadata.js";
import { requirePreprodCoworkerRegistration } from "./registration-authority.js";

type CliOptionValue = string | string[];

export interface CliDependencies {
  env?: AuthEnvironment;
  stdout?: CommandOutput;
  tuiFn?: (options: StatusAppOptions) => Promise<CliResult> | CliResult;
  authManager?: AuthManager;
  coreClient?: CoreHttpClient;
  loginFn?: AuthLoginOptions["loginFn"];
  readStdin?: () => string;
  runtime?: RuntimeDependencies;
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
  user?: AuthWhoamiResult["user"];
  tui?: boolean;
}

const BOOLEAN_OPTION_NAMES = ["create-api-key", "details"] as const;

const VALUE_OPTIONS = new Set<ValueOptionName>([
  ...GLOBAL_VALUE_OPTIONS,
  "search",
  "limit",
  "scope",
  "capability",
  "channel",
  "id",
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
  "coworker-id",
  "event-id",
  "status",
  "comment",
  "agent",
  "input-json",
  "input-file",
  "max-credits",
  "vendor-id",
  "workspace-id",
  "organization-id",
  "organization-slug",
  "provider",
  "model",
  "hermes-path",
  "hermes-home",
  "runtime-directory",
  "timeout-ms",
  "result-file",
  "email",
  "slug",
]);

const REPEATED_VALUE_OPTIONS = new Set<ValueOptionName>([
  "capability",
  "channel",
]);

const BOOLEAN_OPTIONS = new Set<string>(BOOLEAN_OPTION_NAMES);
const CORE_COMMAND_SECTIONS = new Set(
  CLI_COMMAND_CATALOG.map((entry) => entry.command.split(" ")[0]).filter(
    (section) =>
      section !== "skills" && section !== "runtime" && section !== "auth",
  ),
);
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
        throw new CliError(
          "VALIDATION",
          `Option --${name} does not accept a value`,
        );
      }
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name as ValueOptionName)) {
      throw new CliError("VALIDATION", `Unknown option: --${name}`);
    }
    const value = inlineValue === undefined ? argv[index + 1] : inlineValue;
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new CliError("VALIDATION", `Option --${name} requires a value`);
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

function getCoreClient(
  session: CliSession,
  dependencies: CliDependencies,
  organizationSlug?: string,
): CoreHttpClient {
  return (
    dependencies.coreClient ||
    createCoreHttpClient({
      apiUrl: session.config.apiUrl,
      authManager: session.authManager,
      authBaseUrl: session.config.authBaseUrl,
      clientId: session.config.clientId,
      clientSecret: session.config.clientSecret,
      environment: session.env,
      organizationSlug,
    })
  );
}

function writeJsonError(
  stdout: CommandOutput,
  error: unknown,
  environment?: AuthEnvironment,
): void {
  const knownSecrets = [
    environment?.SOKOSUMI_API_KEY,
    environment?.SOKOSUMI_AUTH_TOKEN,
    environment?.SOKOSUMI_OAUTH_CLIENT_SECRET,
  ].filter((secret): secret is string => Boolean(secret));
  const message = redactErrorMessage(error, knownSecrets);
  stdout.write(`${JSON.stringify(buildJsonError(message, error))}\n`);
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
  const coworkerRegistration =
    positionals[0] === "coworkers" &&
    ["register", "provision", "connect"].includes(positionals[1]);
  const adminOnboarding = positionals[0] === "admin";

  if (options.help) {
    stdout.write(formatHelpText());
    return { help: true };
  }
  if (options.version) {
    stdout.write(`${CLI_VERSION}\n`);
    return { version: CLI_VERSION };
  }

  if (positionals[0] === "skills") {
    try {
      await runSkillsCommand({
        subcommand: positionals[1],
        stdout,
        json: options.json,
      });
      return {};
    } catch (error) {
      if (options.json) writeJsonError(stdout, error);
      throw error;
    }
  }

  if (positionals[0] === "runtime") {
    try {
      await runRuntimeCommand({
        positionals,
        options,
        stdout,
        readStdin: dependencies.readStdin,
        dependencies: dependencies.runtime,
      });
      return {};
    } catch (error) {
      if (options.json) writeJsonError(stdout, error);
      throw error;
    }
  }

  let organizationSlug: string | undefined;
  try {
    if (
      positionals[0] === "tasks" &&
      (options["organization-id"] !== undefined ||
        options["workspace-id"] !== undefined)
    ) {
      throw new Error(
        "Task commands do not accept --organization-id or --workspace-id. Use --organization-slug WORKSPACE_SLUG.",
      );
    }
    if (options["organization-slug"] !== undefined) {
      if (positionals[0] !== "tasks") {
        throw new Error(
          "--organization-slug is only supported by tasks commands",
        );
      }
      organizationSlug = validateOrganizationSlug(options["organization-slug"]);
    }
  } catch (error) {
    if (options.json)
      writeJsonError(stdout, error, dependencies.env || process.env);
    throw error;
  }

  let session: CliSession;
  try {
    session = bootstrapCliSession({
      environment: dependencies.env || process.env,
      loadFiles: dependencies.env === undefined,
      preprod: options.preprod,
      preprodDefault: coworkerRegistration || adminOnboarding,
      apiUrl: options["api-url"],
      authUrl: options["auth-url"],
      clientId: options["client-id"],
      authManager: dependencies.authManager,
    });
  } catch (error) {
    if (options.json)
      writeJsonError(stdout, error, dependencies.env || process.env);
    throw error;
  }
  const { env, config, targetExplicit, authManager } = session;
  const networkSelectionLocked = isNetworkSelectionLocked(config, {
    preprod: options.preprod,
    apiUrl: options["api-url"],
  });

  try {
    if (positionals.length === 0) {
      const tuiFn = dependencies.tuiFn || renderStatusApp;
      return await tuiFn({
        authManager,
        env,
        config,
        clientIdOverride: options["client-id"],
        targetExplicit,
        networkSelectionLocked,
        ...(dependencies.coreClient
          ? { coreClient: dependencies.coreClient }
          : {}),
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
    if (coworkerRegistration) {
      requirePreprodCoworkerRegistration(config.target);
    }
    if (adminOnboarding) {
      validateAdminCommand({
        target: config.target,
        subcommand: command,
        positionalId,
        options,
      });
    }
    if (
      CORE_COMMAND_SECTIONS.has(section) ||
      (section === "auth" && command === "whoami" && positionalId === undefined)
    ) {
      await requireAuthenticatedSession(session);
    }
    if (section === "discover" && command === undefined) {
      await runDiscoverCommand({
        client: getCoreClient(session, dependencies),
        config,
        stdout,
        json: options.json,
      });
      return {};
    }
    if (section === "admin") {
      await runAdminCommand({
        client: getCoreClient(session, dependencies),
        stdout,
        json: options.json,
        target: config.target,
        subcommand: command,
        positionalId,
        options,
      });
      return {};
    }
    if (section === "agents") {
      await runAgentsCommand({
        client: getCoreClient(session, dependencies),
        stdout,
        json: options.json,
        subcommand: command,
        positionalId,
        options,
      });
      return {};
    }
    if (section === "coworkers") {
      await runCoworkersCommand({
        client: getCoreClient(session, dependencies),
        stdout,
        json: options.json,
        target: config.target,
        subcommand: command,
        positionalId,
        options,
      });
      return {};
    }
    if (section === "vendors") {
      await runVendorsCommand({
        client: getCoreClient(session, dependencies),
        stdout,
        json: options.json,
        subcommand: command,
        positionalId,
        options,
      });
      return {};
    }
    if (section === "workspaces") {
      await runWorkspacesCommand({
        client: getCoreClient(session, dependencies),
        stdout,
        json: options.json,
        subcommand: command,
        positionalId,
      });
      return {};
    }
    if (section === "tasks") {
      await runTasksCommand({
        client: getCoreClient(session, dependencies, organizationSlug),
        stdout,
        json: options.json,
        subcommand: command,
        positionalId,
        options,
      });
      return {};
    }
    if (section === "jobs") {
      await runJobsCommand({
        client: getCoreClient(session, dependencies),
        stdout,
        json: options.json,
        subcommand: command,
        positionalId,
        options,
      });
      return {};
    }
    if (
      section === "auth" &&
      command === "whoami" &&
      positionalId === undefined
    ) {
      return await runAuthWhoami({
        client: getCoreClient(session, dependencies),
        config,
        stdout,
        json: options.json,
      });
    }
    if (
      section !== "auth" ||
      (command !== "login" && command !== "logout" && command !== "status") ||
      positionalId !== undefined
    ) {
      throw new Error(formatUnknownCommandUsage());
    }

    if (command === "logout") {
      return await runAuthLogout({
        env,
        config,
        authManager,
        stdout,
        json: options.json,
      });
    }
    if (command === "status") {
      return await runAuthStatus({
        env,
        config,
        authManager,
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
      authManager,
      stdout,
    });
  } catch (error) {
    if (options.json) writeJsonError(stdout, error, env);
    throw error;
  }
}
