#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { runCli } from "../src/cli/index.mjs";

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  return runCli(argv, dependencies);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
