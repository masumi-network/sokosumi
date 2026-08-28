#!/usr/bin/env node
/**
 * Run a command with Corepack's pnpm ahead of Vercel's broken tools stub.
 *
 * Vercel fetches packageManager with lifecycle scripts skipped, so pnpm 12's
 * placeholder bin stays on PATH under ~/.local/share/pnpm/.tools. Corepack uses
 * bin/pnpm.mjs and downloads the native binary. Prepend the Node bin dir so
 * turbo/prepare scripts resolve that shim, not the placeholder.
 *
 * Usage (from apps/web or apps/core):
 *   node ../../scripts/ci/vercel-with-pnpm.mjs pnpm install --filter web...
 *   node ../../scripts/ci/vercel-with-pnpm.mjs node ./scripts/vercel-build.mjs
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: vercel-with-pnpm.mjs <command> [args...]");
  process.exit(1);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packageManager = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).packageManager;

if (typeof packageManager !== "string" || !packageManager.startsWith("pnpm@")) {
  console.error(
    `expected root packageManager pnpm@…, got ${JSON.stringify(packageManager)}`,
  );
  process.exit(1);
}

const nodeBinDir = path.dirname(process.execPath);
const env = {
  ...process.env,
  PATH: `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
};

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("corepack", ["enable"]);
run("corepack", ["prepare", packageManager, "--activate"]);
run(args[0], args.slice(1));
