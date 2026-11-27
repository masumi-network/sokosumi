import { Client } from "pg";

import { createSqlTables, sqlTableLayoutFromEnv } from "../src/sql-tables.js";

async function main() {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL.");
  }
  const { sharedTable } = createSqlTables(sqlTableLayoutFromEnv(process.env));
  const client = new Client({
    connectionString,
    options: "-c default_transaction_read_only=on",
  });

  try {
    await client.connect();
    const { rows } = await client.query<Record<string, string>>(`
      SELECT
        (SELECT count(*)::text FROM ${sharedTable("soko_bot_turn").sql}
          WHERE "network" IS NULL) AS soko_bot_turn,
        (SELECT count(*)::text FROM ${sharedTable("soko_bot_delegation").sql}
          WHERE "network" IS NULL AND "jobId" IS NOT NULL) AS soko_bot_delegation,
        (SELECT count(*)::text FROM ${sharedTable("soko_bot_schedule").sql}
          WHERE "network" IS NULL AND "jobId" IS NOT NULL) AS soko_bot_schedule
    `);
    const [counts] = rows;
    if (!counts) throw new Error("Expected one row of counts.");
    for (const [table, count] of Object.entries(counts)) {
      console.log(`${table}: ${count}`);
    }
    if (Object.values(counts).some((count) => count !== "0")) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
