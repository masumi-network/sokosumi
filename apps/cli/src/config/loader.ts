import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliEnvironment } from "../auth/config.js";

export interface CliPreferences {
  apiUrl?: string;
  authUrl?: string;
  webUrl?: string;
  mainnetOAuthClientId?: string;
  preprodOAuthClientId?: string;
}

export interface CliConfigLoadOptions {
  environment?: CliEnvironment;
  cwd?: string;
  homeDir?: string;
  packageRoot?: string;
  loadFiles?: boolean;
}

function findPackageRoot(startPath: string): string {
  let current = resolve(startPath);
  while (true) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(startPath);
    current = parent;
  }
}

const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readOptionalFile(pathname: string): string | null {
  try {
    return readFileSync(pathname, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = assignment.indexOf("=");
    if (separator <= 0) continue;
    const key = assignment.slice(0, separator).trim();
    if (!ENVIRONMENT_KEY.test(key)) continue;
    let value = assignment.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readJsonPreferences(pathname: string): CliPreferences {
  const contents = readOptionalFile(pathname);
  if (contents === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Could not parse CLI config file: ${pathname}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CLI config file must contain a JSON object: ${pathname}`);
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.apiUrl === "string" && record.apiUrl.trim()
      ? { apiUrl: record.apiUrl.trim() }
      : {}),
    ...(typeof record.authUrl === "string" && record.authUrl.trim()
      ? { authUrl: record.authUrl.trim() }
      : {}),
    ...(typeof record.webUrl === "string" && record.webUrl.trim()
      ? { webUrl: record.webUrl.trim() }
      : {}),
    ...(typeof record.mainnetOAuthClientId === "string" &&
    record.mainnetOAuthClientId.trim()
      ? { mainnetOAuthClientId: record.mainnetOAuthClientId.trim() }
      : {}),
    ...(typeof record.preprodOAuthClientId === "string" &&
    record.preprodOAuthClientId.trim()
      ? { preprodOAuthClientId: record.preprodOAuthClientId.trim() }
      : {}),
  };
}

function preferencesToEnvironment(
  preferences: CliPreferences,
): Record<string, string> {
  return {
    ...(preferences.apiUrl ? { SOKOSUMI_API_URL: preferences.apiUrl } : {}),
    ...(preferences.authUrl ? { SOKOSUMI_AUTH_URL: preferences.authUrl } : {}),
    ...(preferences.webUrl ? { SOKOSUMI_WEB_URL: preferences.webUrl } : {}),
    ...(preferences.mainnetOAuthClientId
      ? { SOKOSUMI_MAINNET_OAUTH_CLIENT_ID: preferences.mainnetOAuthClientId }
      : {}),
    ...(preferences.preprodOAuthClientId
      ? { SOKOSUMI_PREPROD_OAUTH_CLIENT_ID: preferences.preprodOAuthClientId }
      : {}),
  };
}

function readLocalEnvironment(
  cwd: string,
  packageRoot: string,
): Record<string, string> {
  const packageEnv = readOptionalFile(join(packageRoot, ".env"));
  const cwdEnv = readOptionalFile(join(cwd, ".env"));
  return {
    ...(packageEnv ? parseDotEnv(packageEnv) : {}),
    ...(cwdEnv ? parseDotEnv(cwdEnv) : {}),
  };
}

export function loadCliEnvironment({
  environment = process.env,
  cwd = process.cwd(),
  homeDir = homedir(),
  packageRoot = PACKAGE_ROOT,
  loadFiles = true,
}: CliConfigLoadOptions = {}): Record<string, string | undefined> {
  if (!loadFiles) return { ...environment };

  const fileEnvironment = readLocalEnvironment(cwd, packageRoot);
  const preferences = readJsonPreferences(
    join(homeDir, ".sokosumi", "config.json"),
  );
  return {
    ...fileEnvironment,
    ...preferencesToEnvironment(preferences),
    ...environment,
  };
}
