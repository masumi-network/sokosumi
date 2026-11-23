import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";

// Two clients on one pool, one on `public` and one on a throwaway schema.
// RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/database exec vitest run src/client.postgres.test.ts
const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

describe.skipIf(!enabled)("createPrismaClient schema on PostgreSQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const schema = `client_schema_${suffix}`;
  const pool = new Pool({ connectionString: url });
  const publicClient = createPrismaClient(pool, { schema: "public" });
  const schemaClient = createPrismaClient(pool, { schema });

  afterAll(async () => {
    await publicClient.lock.deleteMany({
      where: { key: { startsWith: suffix } },
    });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await publicClient.$disconnect();
    await schemaClient.$disconnect();
    await pool.end();
  });

  it("writes and reads each client's rows in its own schema on a shared pool", async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      `CREATE TABLE "${schema}"."Lock" (LIKE public."Lock" INCLUDING ALL)`,
    );

    await publicClient.lock.create({ data: { key: `${suffix}:public` } });
    await schemaClient.lock.create({ data: { key: `${suffix}:schema` } });

    const keys = async (client: typeof publicClient) =>
      (
        await client.lock.findMany({
          where: { key: { startsWith: suffix } },
          select: { key: true },
        })
      ).map((row) => row.key);
    expect(await keys(publicClient)).toEqual([`${suffix}:public`]);
    expect(await keys(schemaClient)).toEqual([`${suffix}:schema`]);
  });
});
