#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type CliDependencies,
  type CliResult,
  runCli,
} from "../src/cli/index.js";

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
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
