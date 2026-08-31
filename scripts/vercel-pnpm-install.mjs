#!/usr/bin/env node
/**
 * Vercel installCommand helper.
 *
 * Hosted builds still put pnpm 9 or 10 on PATH when ENABLE_EXPERIMENTAL_COREPACK
 * is unset (lockfileVersion 9.0). That binary cannot install a pnpm 12 lockfile.
 * npm install of pnpm@<pinned> runs install.js and yields the real Rust CLI,
 * unlike Corepack/npx which can hit the placeholder bin/pnpm.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find pnpm-workspace.yaml from ${path.resolve(startDir)}`,
      );
    }
    dir = parent;
  }
}

export function readPinnedPnpmVersion(repoRoot) {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const spec = pkg.packageManager;
  if (typeof spec !== "string" || !spec.startsWith("pnpm@")) {
    throw new Error(
      `Expected packageManager pnpm@<version>, got ${String(spec)}`,
    );
  }
  const version = spec.slice("pnpm@".length);
  if (!version) {
    throw new Error(`Empty pnpm version in packageManager: ${spec}`);
  }
  return version;
}

export function pnpmInstallArgs(filter) {
  return ["install", "--frozen-lockfile", "--filter", filter];
}

export function pnpmBinPath(prefixDir) {
  return path.join(prefixDir, "node_modules", ".bin", "pnpm");
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const error = new Error(
      `${command} ${args.join(" ")} exited ${result.status}`,
    );
    error.status = result.status ?? 1;
    throw error;
  }
  return result;
}

export function vercelPnpmInstall(options) {
  const cwd = options.cwd ?? process.cwd();
  const filter = options.filter;
  if (!filter) {
    throw new Error("filter is required");
  }

  const repoRoot = findRepoRoot(cwd);
  const version = readPinnedPnpmVersion(repoRoot);
  const prefixDir =
    options.prefixDir ?? path.join(tmpdir(), `sokosumi-pnpm-${version}`);
  mkdirSync(prefixDir, { recursive: true });

  console.log(`Installing pnpm@${version} into ${prefixDir}`);
  runOrThrow("npm", ["install", "--prefix", prefixDir, `pnpm@${version}`], {
    cwd: repoRoot,
  });

  const pnpmBin = pnpmBinPath(prefixDir);
  const args = pnpmInstallArgs(filter);
  console.log(`Running ${pnpmBin} ${args.join(" ")}`);
  runOrThrow(pnpmBin, args, { cwd: repoRoot });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  const filter = process.argv[2];
  if (!filter) {
    console.error("usage: node scripts/vercel-pnpm-install.mjs <pnpm-filter>");
    process.exit(1);
  }
  try {
    vercelPnpmInstall({ filter });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 1;
    process.exit(status);
  }
}
