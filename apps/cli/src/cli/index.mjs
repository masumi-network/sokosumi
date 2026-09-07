import { createRequire } from "node:module";
import { renderStatusApp } from "../tui/status-app.mjs";
import { runAuthLogin } from "./auth-login.mjs";
import { runAuthLogout } from "./auth-logout.mjs";

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require("../../package.json");

const PREPROD_API_URL = "https://api.preprod.sokosumi.com";

const HELP_TEXT = `Sokosumi CLI v${CLI_VERSION}

Usage:
  sokosumi
  sokosumi auth login [--json]
  sokosumi auth logout [--json]

Empty argv opens the TUI. Sign in in the browser, then register a Coworker
(pi-sokosumi, Eve, Hermes, OpenClaw). Workspace chat + Tasks come after connect.

Global options:
  --api-url URL
  --preprod
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

function parseArgv(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--json") {
      options.json = true;
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
    options[name] = value;
    index += 1;
  }
  return { positionals, options };
}

function applyGlobalEnv(env, options) {
  const next = { ...env };
  if (options.preprod) {
    next.SOKOSUMI_API_URL = PREPROD_API_URL;
  }
  if (options["api-url"]) {
    next.SOKOSUMI_API_URL = options["api-url"];
  }
  return next;
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const { positionals, options } = parseArgv(argv);
  const stdout = dependencies.stdout || process.stdout;

  if (options.help) {
    stdout.write(`${HELP_TEXT}`);
    return { help: true };
  }
  if (options.version) {
    stdout.write(`${CLI_VERSION}\n`);
    return { version: CLI_VERSION };
  }

  const env = applyGlobalEnv(dependencies.env || process.env, options);

  if (positionals.length === 0) {
    const tuiFn = dependencies.tuiFn || renderStatusApp;
    return tuiFn({
      ...dependencies,
      env,
    });
  }

  const [section, command, ...rest] = positionals;
  if (rest.length > 0) {
    throw new Error(`Unexpected argument: ${rest[0]}`);
  }
  if (section !== "auth" || (command !== "login" && command !== "logout")) {
    throw new Error("Usage: sokosumi auth login|logout [--json]");
  }

  if (command === "logout") {
    return runAuthLogout({
      ...dependencies,
      json: options.json,
    });
  }

  return runAuthLogin({
    ...dependencies,
    env,
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
    json: options.json,
  });
}
