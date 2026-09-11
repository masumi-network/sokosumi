import { spawn as defaultSpawn, execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { promptForUpdateWithInk } from "../tui/update-prompt.js";
import { CLI_PACKAGE_NAME } from "./metadata.js";

const NPM_REGISTRY_HOST = "https://registry.npmjs.org";
const REGISTRY_URL = `${NPM_REGISTRY_HOST}/${encodeURIComponent(CLI_PACKAGE_NAME)}/latest`;
const UPDATE_TIMEOUT_MS = 2_000;
const NPM_EXECUTABLE = process.platform === "win32" ? "npm.cmd" : "npm";
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "npm_config_prefix",
] as const;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type Prompt = (message: string) => Promise<string>;

export interface NpmExecOptions {
  env: NodeJS.ProcessEnv;
}

export interface UpdateCheckDependencies {
  fetch?: typeof fetch;
  prompt?: Prompt;
  isGlobalInstall?: (environment: NodeJS.ProcessEnv) => boolean;
  npmExec?: (
    command: string,
    args: readonly string[],
    options: NpmExecOptions,
  ) => Promise<void>;
  environment?: NodeJS.ProcessEnv;
}

function sanitizeEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = environment[key];
    if (value !== undefined) sanitized[key] = value;
  }
  return sanitized;
}

export interface UpdateCheckOptions extends UpdateCheckDependencies {
  currentVersion: string;
  interactive: boolean;
}

function parseStableVersion(value: unknown): [bigint, bigint, bigint] | null {
  if (typeof value !== "string") return null;
  const match = STABLE_VERSION.exec(value);
  if (!match) return null;
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = parseStableVersion(current);
  const latestParts = parseStableVersion(latest);
  if (!currentParts || !latestParts) return false;
  for (let index = 0; index < currentParts.length; index += 1) {
    if (latestParts[index] !== currentParts[index]) {
      return latestParts[index] > currentParts[index];
    }
  }
  return false;
}

function npmInvocation(
  command: string,
  args: readonly string[],
): { command: string; args: readonly string[] } {
  if (process.platform !== "win32") return { command, args };
  return {
    command: process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}

async function runNpmInstall(
  command: string,
  args: readonly string[],
  { env }: NpmExecOptions,
): Promise<void> {
  const invocation = npmInvocation(command, args);
  await new Promise<void>((resolve, reject) => {
    const child = defaultSpawn(invocation.command, invocation.args, {
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm exited with code ${String(code)}`));
    });
  });
}

export async function checkForUpdate({
  currentVersion,
  interactive,
  fetch: fetchImpl = fetch,
  prompt = promptForUpdateWithInk,
  isGlobalInstall = () => false,
  npmExec = runNpmInstall,
  environment: environmentInput = process.env,
}: UpdateCheckOptions): Promise<string | null> {
  if (!interactive) return null;
  const environment = sanitizeEnvironment(environmentInput);
  try {
    if (!isGlobalInstall(environment)) return null;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const metadata: unknown = await response.json();
    const latestVersion =
      typeof metadata === "object" && metadata !== null && "version" in metadata
        ? metadata.version
        : undefined;
    if (
      typeof latestVersion !== "string" ||
      !isNewerVersion(currentVersion, latestVersion)
    ) {
      return null;
    }

    const answer = (
      await prompt(
        `Update Sokosumi from v${currentVersion} to v${latestVersion}? [y/N]`,
      )
    )
      .trim()
      .toLowerCase();
    if (answer !== "y" && answer !== "yes") return null;

    try {
      await npmExec(
        NPM_EXECUTABLE,
        [
          "install",
          "--global",
          "--ignore-scripts",
          `${CLI_PACKAGE_NAME}@${latestVersion}`,
        ],
        { env: environment },
      );
      return latestVersion;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type ExecFileSyncLike = (
  file: string,
  args: readonly string[],
  options: {
    encoding: "utf8";
    stdio: ["ignore", "pipe", "ignore"];
    timeout: number;
    env: NodeJS.ProcessEnv;
  },
) => string | Buffer;

export function isNpmGlobalInstall(
  entrypointPath: string,
  execFileSyncImpl: ExecFileSyncLike = execFileSync as ExecFileSyncLike,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const packageRoot = realpathSync(
      resolve(dirname(realpathSync(entrypointPath)), "..", ".."),
    );
    const invocation = npmInvocation(NPM_EXECUTABLE, ["root", "--global"]);
    const globalRoot = String(
      execFileSyncImpl(invocation.command, invocation.args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: UPDATE_TIMEOUT_MS,
        env: sanitizeEnvironment(environment),
      }),
    ).trim();
    if (!globalRoot) return false;
    const globalPackagePath = join(globalRoot, CLI_PACKAGE_NAME);
    if (lstatSync(globalPackagePath).isSymbolicLink()) return false;
    const canonicalGlobalRoot = realpathSync(globalRoot);
    const expectedCanonicalPackagePath = join(
      canonicalGlobalRoot,
      CLI_PACKAGE_NAME,
    );
    const realGlobalPackagePath = realpathSync(globalPackagePath);
    const normalized = (path: string) =>
      process.platform === "win32" ? path.toLowerCase() : path;
    if (
      normalized(realGlobalPackagePath) !==
      normalized(expectedCanonicalPackagePath)
    )
      return false;
    return (
      normalized(realpathSync(packageRoot)) ===
      normalized(realGlobalPackagePath)
    );
  } catch {
    return false;
  }
}
