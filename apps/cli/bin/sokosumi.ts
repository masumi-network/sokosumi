#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type CliDependencies,
  type CliResult,
  runCli,
} from "../src/cli/index.js";
import { CLI_VERSION } from "../src/cli/metadata.js";
import { checkForUpdate, isNpmGlobalInstall } from "../src/cli/update-check.js";

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
    const updateCheck = dependencies.updateCheck;
    const updatedVersion = await checkForUpdate({
      ...updateCheck,
      currentVersion: CLI_VERSION,
      interactive: true,
      isGlobalInstall:
        updateCheck?.isGlobalInstall ??
        ((environment) =>
          isNpmGlobalInstall(
            fileURLToPath(import.meta.url),
            undefined,
            environment,
          )),
    });
    if (updatedVersion !== null) {
      (dependencies.stdout || process.stdout).write(
        `Sokosumi updated to v${updatedVersion}. Please restart Sokosumi to continue.\n`,
      );
      return {};
    }
  }
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
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
