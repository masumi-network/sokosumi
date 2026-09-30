import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const migrationSql = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20260930181719_task_priority/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

// Opt-in real Postgres proof. Applies the migration to a stub table in a
// throwaway schema: existing rows default to NONE and ORDER BY priority lists
// urgent first, none last.
describe.skipIf(!enabled)("task priority migration against PostgreSQL", () => {
  it("defaults to NONE and orders urgent first, none last", async () => {
    if (!db) throw new Error("Missing integration database");
    await db.$transaction(
      async (tx) => {
        const schema = `priority_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe("CREATE TABLE task (id text PRIMARY KEY)");
        await tx.$executeRaw`INSERT INTO task VALUES ('existing')`;
        await tx.$executeRawUnsafe(migrationSql);
        await tx.$executeRaw`INSERT INTO task (id, priority) VALUES ('low', 'LOW'), ('urgent', 'URGENT'), ('medium', 'MEDIUM'), ('high', 'HIGH')`;

        const rows = await tx.$queryRaw<{ id: string; priorityText: string }[]>`
          SELECT id, priority::text AS "priorityText" FROM task ORDER BY task.priority ASC, id ASC`;

        expect(rows.map((row) => row.id)).toEqual([
          "urgent",
          "high",
          "medium",
          "low",
          "existing",
        ]);
        expect(rows.at(-1)?.priorityText).toBe("NONE");
        await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      },
      { timeout: 20000 },
    );
  });
});
