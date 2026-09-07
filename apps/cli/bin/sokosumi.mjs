#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/cli/index.mjs";

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  return runCli(argv, dependencies);
}

export function isDirectEntrypoint(
  argvPath = process.argv[1],
  moduleUrl = import.meta.url,
) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

if (isDirectEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
