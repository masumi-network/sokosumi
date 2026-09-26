import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const prismaDir = join(packageRoot, "prisma");
const migrationsDir = join(prismaDir, "migrations");

/** Every migration, in apply order, so the replay sees the final state. */
function migrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort()
    .map((entry) => {
      try {
        return readFileSync(
          join(migrationsDir, entry, "migration.sql"),
          "utf8",
        );
      } catch {
        return "";
      }
    })
    .join("\n");
}

function schemaText(): string {
  return readdirSync(prismaDir)
    .filter((entry) => entry.endsWith(".prisma"))
    .map((entry) => readFileSync(join(prismaDir, entry), "utf8"))
    .join("\n");
}

/** Partial unique index name → table, after replaying drops and renames. */
function livePartialUniques(sql: string): Map<string, string> {
  const live = new Map<string, string>();
  const statement =
    /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?"(\w+)"\s+ON\s+"(\w+)"[^;]*?\bWHERE\b|DROP INDEX (?:IF EXISTS )?"(\w+)"|ALTER INDEX (?:IF EXISTS )?"(\w+)" RENAME TO "(\w+)"|DROP TABLE (?:IF EXISTS )?"(\w+)"|ALTER TABLE "(\w+)" RENAME TO "(\w+)"/g;
  for (const match of sql.matchAll(statement)) {
    const [
      ,
      created,
      table,
      dropped,
      from,
      to,
      droppedTable,
      oldTable,
      newTable,
    ] = match;
    if (created && table) {
      live.set(created, table);
    } else if (dropped) {
      live.delete(dropped);
    } else if (from && to && live.has(from)) {
      live.set(to, live.get(from) ?? "");
      live.delete(from);
    } else if (droppedTable) {
      for (const [name, owner] of live) {
        if (owner === droppedTable) live.delete(name);
      }
    } else if (oldTable && newTable) {
      for (const [name, owner] of live) {
        if (owner === oldTable) live.set(name, newTable);
      }
    }
  }
  return live;
}

describe("partial unique indexes created in migrations", () => {
  it("are declared in the schema so `prisma migrate dev` never drops them", () => {
    const live = [...livePartialUniques(migrationSql()).keys()];
    expect(live.length).toBeGreaterThan(0);

    const schema = schemaText();
    const undeclared = live.filter(
      (name) => !schema.includes(`map: "${name}"`),
    );
    expect(undeclared).toEqual([]);
  });
});
