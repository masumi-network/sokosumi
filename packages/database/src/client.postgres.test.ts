import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "./client.js";

// Two clients on one pool, one on `public` and one on a throwaway schema.
// RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/database exec vitest run src/client.postgres.test.ts
const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

type Client = ReturnType<typeof createPrismaClient>;

describe.skipIf(!enabled)("createPrismaClient schema on PostgreSQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const schema = `client_schema_${suffix}`;
  let pool: Pool | undefined;
  let publicClient: Client | undefined;
  let schemaClient: Client | undefined;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    publicClient = createPrismaClient(pool, { schema: "public" });
    schemaClient = createPrismaClient(pool, { schema });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      `CREATE TABLE "${schema}"."Lock" (LIKE public."Lock" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const step of [
      () =>
        publicClient?.lock.deleteMany({
          where: { key: { startsWith: suffix } },
        }),
      () => pool?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`),
      () => publicClient?.$disconnect(),
      () => schemaClient?.$disconnect(),
      () => pool?.end(),
    ]) {
      try {
        await step();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Teardown failed");
  });

  it("writes and reads each client's rows in its own schema on a shared pool", async () => {
    if (!publicClient || !schemaClient) throw new Error("Clients not built");
    await publicClient.lock.create({ data: { key: `${suffix}:public` } });
    await schemaClient.lock.create({ data: { key: `${suffix}:schema` } });

    const keys = async (client: Client) =>
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
