import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const reparentSql = readFileSync(
  new URL(
    "../../../../../packages/database/prisma/migrations/20261118150000_task_subtask_reparent/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Top-level statements; a `;` inside a `$$` function body does not end one. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  for (const part of sql.split(/;\s*\n/)) {
    current = current ? `${current};\n${part}` : part;
    if ((current.match(/\$\$/g) ?? []).length % 2 === 0) {
      const body = current
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (body) statements.push(body);
      current = "";
    }
  }
  return statements;
}

class Rollback extends Error {}

// Prisma does not run a migration file in one transaction. After a failure
// part-way through, the retry runs every statement again on a table that
// already has the earlier ones (SOKD-279).
describe.skipIf(!enabled)("task sub-task reparent migration", () => {
  it("runs again on a database where it already ran", async () => {
    const statements = splitStatements(reparentSql);
    expect(statements.length).toBeGreaterThan(1);

    // The test database already has this migration. Run it again, then roll
    // back, so the schema stays as it was.
    const result = await prisma
      .$transaction(async (tx) => {
        for (const statement of statements) {
          await tx.$executeRawUnsafe(statement);
        }
        throw new Rollback();
      })
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Rollback);
  });
});
