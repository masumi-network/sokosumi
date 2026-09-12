#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type CliDependencies,
  type CliResult,
  runCli,
} from "../src/cli/index.js";
import { redactErrorMessage } from "../src/error-redaction.js";

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  return runCli(argv, dependencies);
}

export function isDirectEntrypoint(
  argvPath: string | undefined = process.argv[1],
  moduleUrl: string = import.meta.url,
): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

if (isDirectEntrypoint()) {
  main().catch((error: unknown) => {
    if (process.argv.slice(2).includes("--json")) {
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${redactErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
