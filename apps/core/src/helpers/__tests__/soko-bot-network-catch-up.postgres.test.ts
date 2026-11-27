import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const TABLES = [
  "soko_bot_turn",
  "soko_bot_delegation",
  "soko_bot_schedule",
] as const;
const execFileAsync = promisify(execFile);

describe.skipIf(!enabled)("Soko Bot Network count", () => {
  it.each(TABLES)(
    "counts only eligible %s rows and fails the gate when any remain",
    async (target) => {
      const schema = `catch_up_${randomUUID().replaceAll("-", "")}`;
      const env = {
        ...process.env,
        DATABASE_URL_UNPOOLED: "",
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
      const count = (connectionEnv: NodeJS.ProcessEnv = {}) =>
        execFileAsync(
          process.execPath,
          ["--import", "tsx", "scripts/count-soko-bot-network-catch-up.ts"],
          {
            cwd: fileURLToPath(databasePackage),
            env: { ...env, ...connectionEnv },
          },
        );
      const countOutput = (remaining: number) =>
        TABLES.map(
          (name) => `${name}: ${name === target ? remaining : 0}\n`,
        ).join("");

      await client.connect();
      try {
        // The CLI connects separately. Give it committed fixtures in a private
        // schema so the gate counts only this test's rows.
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
        await expect(count()).rejects.toMatchObject({
          code: 1,
          stdout: countOutput(1),
        });

        await client.query(`DELETE FROM ${table} WHERE fixture = 1`);
        await expect(
          count({
            DATABASE_URL_UNPOOLED: process.env.DATABASE_URL,
            DATABASE_URL: "invalid",
          }),
        ).resolves.toMatchObject({ stdout: countOutput(0) });
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
