/**
 * Retry for `prisma migrate deploy` while the database refuses connections.
 * P1001 means Prisma never connected, so nothing was applied and the command
 * is safe to run again. Every other failure is returned at once.
 */

import { stripVTControlCharacters } from "node:util";

/** Prisma: "Can't reach database server". */
const DATABASE_UNREACHABLE_CODE = "P1001";
/** How the CLI prints it; a migration name or SQL text does not match. */
const DATABASE_UNREACHABLE_LINE = `Error: ${DATABASE_UNREACHABLE_CODE}:`;

/** Wait before each further attempt. Its length is the number of retries. */
export const MIGRATE_DEPLOY_RETRY_DELAYS_MS: readonly number[] = [
  5_000, 10_000, 20_000, 30_000,
];

export interface MigrateDeployRun {
  /** Exit code of the Prisma CLI. */
  code: number;
  /** Its stdout and stderr, joined. */
  output: string;
}

export interface MigrateDeployRetryOptions {
  run: () => Promise<MigrateDeployRun>;
  wait: (ms: number) => Promise<void>;
  log: (message: string) => void;
  delaysMs?: readonly number[];
}

/** Runs the migration until it settles; resolves to the last exit code. */
export async function migrateDeployWithRetry({
  run,
  wait,
  log,
  delaysMs = MIGRATE_DEPLOY_RETRY_DELAYS_MS,
}: MigrateDeployRetryOptions): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    const { code, output } = await run();
    const delayMs = delaysMs[attempt];
    if (
      code === 0 ||
      delayMs === undefined ||
      // With FORCE_COLOR or a TTY the CLI puts colour codes inside the line.
      !stripVTControlCharacters(output).includes(DATABASE_UNREACHABLE_LINE)
    ) {
      return code;
    }
    log(
      `[prisma] database not reachable (${DATABASE_UNREACHABLE_CODE}); retry ${attempt + 1} of ${delaysMs.length} in ${delayMs / 1000} s`,
    );
    await wait(delayMs);
  }
}
