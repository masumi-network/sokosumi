/**
 * `prisma migrate deploy`, run again while the database is not reachable yet.
 *
 *   pnpm --filter @sokosumi/database prisma:migrate:deploy
 */

import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

import {
  type MigrateDeployRun,
  migrateDeployWithRetry,
} from "../src/helpers/migrate-deploy-retry.js";

function runPrismaMigrateDeploy(): Promise<MigrateDeployRun> {
  return new Promise((resolve, reject) => {
    // `pnpm run` puts node_modules/.bin on PATH.
    const child = spawn(
      "prisma",
      ["migrate", "deploy", ...process.argv.slice(2)],
      { stdio: ["inherit", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    // A signal leaves `code` null: report that as a failure.
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

process.exitCode = await migrateDeployWithRetry({
  run: runPrismaMigrateDeploy,
  wait: (ms) => wait(ms),
  log: (message) => console.warn(message),
});
