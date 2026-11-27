import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const databasePackage = new URL(
  "../../../../../packages/database/",
  import.meta.url,
);
const migration = readFileSync(
  new URL(
    "prisma/migrations/20261127090602_soko_bot_network_catch_up/migration.sql",
    databasePackage,
  ),
  "utf8",
);
const TABLES = [
  "soko_bot_turn",
  "soko_bot_delegation",
  "soko_bot_schedule",
] as const;
const execFileAsync = promisify(execFile);

describe.skipIf(!enabled)("Soko Bot Network catch-up", () => {
  it.each(TABLES)(
    "backfills only eligible %s rows and clears their gate count",
    async (target) => {
      const schema = `catch_up_${randomUUID().replaceAll("-", "")}`;
      const env = {
        ...process.env,
        DATABASE_SCHEMA_SHARED: schema,
        DATABASE_SCHEMA_MAINNET: "catch_up_mainnet",
        DATABASE_SCHEMA_PREPROD: "catch_up_preprod",
        NETWORK_PREPROD_ENABLED: "false",
      };
      const { sharedTable } = createSqlTables(sqlTableLayoutFromEnv(env));
      const original = createSqlTables(sqlTableLayoutFromEnv(process.env));
      const table = sharedTable(target).sql;
      const hasJob = target !== "soko_bot_turn";
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      const count = () =>
        execFileAsync(
          process.execPath,
          ["--import", "tsx", "scripts/count-soko-bot-network-catch-up.ts"],
          { cwd: fileURLToPath(databasePackage), env },
        );
      const countOutput = (remaining: number) =>
        TABLES.map(
          (name) => `${name}: ${name === target ? remaining : 0}\n`,
        ).join("");

      await client.connect();
      try {
        // The CLI connects separately. Give it committed fixtures in a private
        // schema so the migration cannot touch another test's rows.
        await client.query(`CREATE SCHEMA "${schema}"`);
        for (const name of TABLES) {
          const links = name === "soko_bot_turn" ? "" : ', "jobId", "taskId"';
          await client.query(`
            CREATE TABLE ${sharedTable(name).sql} AS
            SELECT 0::int AS fixture, "network", "updatedAt"${links}
            FROM ${original.sharedTable(name).sql} WITH NO DATA
          `);
        }
        await client.query(`
          INSERT INTO ${table} (fixture, "network", "updatedAt")
          VALUES
            (1, NULL, '2026-11-26 08:00:00'),
            (2, 'preprod', '2026-11-26 09:00:00')
        `);
        if (hasJob) {
          await client.query(`UPDATE ${table} SET "jobId" = $1`, [
            randomUUID(),
          ]);
          await client.query(
            `INSERT INTO ${table} (fixture, "updatedAt", "taskId")
             VALUES (3, '2026-11-26 10:00:00', NULL),
                    (4, '2026-11-26 11:00:00', $1)`,
            [randomUUID()],
          );
        }
        const readRows = async () =>
          (
            await client.query<Record<string, unknown>>(
              `SELECT *, ctid::text AS tuple FROM ${table} ORDER BY fixture`,
            )
          ).rows;

        const [eligible, ...untouched] = await readRows();
        await expect(count()).rejects.toMatchObject({
          code: 1,
          stdout: countOutput(1),
        });

        await client.query(`SET search_path TO "${schema}"`);
        await client.query(migration);
        const [tagged, ...remaining] = await readRows();
        expect(tagged).toMatchObject({
          ...eligible,
          network: "mainnet",
          tuple: expect.any(String),
        });
        expect(remaining).toStrictEqual(untouched);
        await expect(count()).resolves.toMatchObject({
          stdout: countOutput(0),
        });

        await client.query(migration);
        expect(await readRows()).toStrictEqual([tagged, ...remaining]);
      } finally {
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await client.end();
        }
      }
    },
    20_000,
  );
});
