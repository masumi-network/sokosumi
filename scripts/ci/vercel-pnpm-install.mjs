#!/usr/bin/env node
/**
 * Vercel install bootstrap for pnpm 12+.
 *
 * Vercel's packageManager fetch leaves pnpm 12's placeholder bin/pnpm when
 * lifecycle scripts are skipped. Corepack loads bin/pnpm.mjs, which downloads
 * the native binary. Wire this from each app vercel.json installCommand.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filter = process.argv[2];
if (!filter) {
  console.error("usage: vercel-pnpm-install.mjs <pnpm-filter>");
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

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
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
run("corepack", ["pnpm", "install", "--filter", filter]);
