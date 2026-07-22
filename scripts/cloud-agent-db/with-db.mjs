#!/usr/bin/env node
/**
 * Run a command with Cloud agent DATABASE_URL overrides applied.
 *
 * Usage:
 *   node scripts/cloud-agent-db/with-db.mjs -- pnpm core:dev
 *   node scripts/cloud-agent-db/with-db.mjs -- pnpm prisma:migrate:deploy
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyUrlsToProcessEnv, readUrlsFile } from "./apply-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function printHelp() {
  console.log(
    `Usage: node scripts/cloud-agent-db/with-db.mjs -- <command> [args...]`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf("--");
  const commandArgs = sep === -1 ? argv : argv.slice(sep + 1);

  if (commandArgs.length === 0 || commandArgs[0] === "--help") {
    printHelp();
    process.exit(commandArgs[0] === "--help" ? 0 : 1);
  }

  const urls = await readUrlsFile(REPO_ROOT);
  if (urls) {
    applyUrlsToProcessEnv(urls);
  } else {
    console.warn(
      "[cloud-agent-db] no provisioned env at .cursor/cloud-agent-db.urls.json; running with ambient DATABASE_URL",
    );
  }

  const [command, ...args] = commandArgs;
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

await main();
