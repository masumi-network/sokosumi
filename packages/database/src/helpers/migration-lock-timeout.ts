import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_PREFIX } from "./migration-prefix-uniqueness.js";

// Last migration on main when the check was introduced. Applied SQL is fixed.
const LOCK_TIMEOUT_CUTOFF = "20261126114236";

export function findLockTimeoutViolations(migrationsDir: string): string[] {
  const violations: string[] = [];
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    const stamp = MIGRATION_PREFIX.exec(entry.name)?.[1];
    if (!entry.isDirectory() || !stamp || stamp <= LOCK_TIMEOUT_CUTOFF) {
      continue;
    }

    const file = `${entry.name}/migration.sql`;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    if (
      /\bALTER TABLE\b/i.test(sql) &&
      !/\bSET lock_timeout\b/i.test(sql) &&
      !/^[ \t]*-- lock-timeout: not needed,[ \t]*\S/m.test(sql)
    ) {
      violations.push(`${file} needs a lock timeout.
A waiting ACCESS EXCLUSIVE lock queues later reads and writes on the table.
Set the timeout before those statements and reset it afterward.
Prisma does not write these lines: add them by hand.
SET lock_timeout = '5s';
RESET lock_timeout;
For an exception, add -- lock-timeout: not needed, <reason> on its own line.
See docs/agents/migrations.md#lock-timeouts.`);
    }
  }
  return violations;
}
