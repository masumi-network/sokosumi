/**
 * `sharedTable` and `netTable` on the split layout: one statement, written
 * once, lands in the schema of the Network it was built for and nowhere else.
 * Rows are read back through Prisma model clients, which name their schema
 * without the helper. Runs only on the split layout (`onSplitLayout`).
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import {
  configureSqlTables,
  createSqlTables,
  PUBLIC_LAYOUT,
  type SqlTableLayout,
  type TableNetwork,
} from "@sokosumi/database/sql-tables";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const NETWORKS: readonly TableNetwork[] = ["mainnet", "preprod"];
const key = `n16-${randomUUID().slice(0, 12)}`;

describe.runIf(onSplitLayout)("raw SQL tables on the split layout", () => {
  const names = testSchemaNames();
  const layout: SqlTableLayout = {
    shared: names.DATABASE_SCHEMA_SHARED,
    mainnet: names.DATABASE_SCHEMA_MAINNET,
    preprod: names.DATABASE_SCHEMA_PREPROD,
    preprodOn: true,
  };
  const tables = createSqlTables(layout);
  let pool: Pool;
  let models: Record<
    "shared" | TableNetwork,
    ReturnType<typeof createPrismaClient>
  >;

  /** The same statement for either Network: only the Network differs. */
  function insertTag(network: TableNetwork, name: string) {
    return models.shared.$executeRaw`
      INSERT INTO ${tables.netTable(network, "Tag")} (id, "updatedAt", name)
      VALUES (${randomUUID()}, now(), ${name})`;
  }

  async function tagsThroughModels(network: TableNetwork, prefix: string) {
    const tags = await models[network].tag.findMany({
      where: { name: { startsWith: prefix } },
      orderBy: { name: "asc" },
    });
    return tags.map((tag) => tag.name);
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    models = {
      shared: createPrismaClient(pool, { schema: layout.shared }),
      mainnet: createPrismaClient(pool, { schema: layout.mainnet }),
      preprod: createPrismaClient(pool, { schema: layout.preprod }),
    };
  });

  afterAll(async () => {
    configureSqlTables(PUBLIC_LAYOUT);
    for (const network of NETWORKS) {
      await models[network].tag.deleteMany({
        where: { name: { startsWith: key } },
      });
    }
    await models.shared.lock.deleteMany({
      where: { key: { startsWith: key } },
    });
    await pool.end();
  });

  it("lands one statement in the Network it names, invisible on the other", async () => {
    const prefix = `${key}:write`;
    await insertTag("preprod", `${prefix}:preprod`);
    await insertTag("mainnet", `${prefix}:mainnet`);

    expect(await tagsThroughModels("preprod", prefix)).toEqual([
      `${prefix}:preprod`,
    ]);
    expect(await tagsThroughModels("mainnet", prefix)).toEqual([
      `${prefix}:mainnet`,
    ]);
    for (const network of NETWORKS) {
      const rows = await models.shared.$queryRaw<{ name: string }[]>`
        SELECT name FROM ${tables.netTable(network, "Tag")}
        WHERE name LIKE ${`${prefix}%`}`;
      expect(rows).toEqual([{ name: `${prefix}:${network}` }]);
    }
  });

  it("joins a Network table to a shared table in one statement", async () => {
    const prefix = `${key}:join`;
    for (const network of NETWORKS) {
      await insertTag(network, `${prefix}:${network}`);
    }
    await models.shared.lock.createMany({
      data: NETWORKS.map((network) => ({ key: `${prefix}:${network}` })),
    });

    for (const network of NETWORKS) {
      const rows = await models.shared.$queryRaw<{ key: string }[]>`
        SELECT l.key
        FROM ${tables.netTable(network, "Tag")} t
        JOIN ${tables.sharedTable("Lock")} l ON l.key = t.name
        WHERE t.name LIKE ${`${prefix}%`}`;
      expect(rows).toEqual([{ key: `${prefix}:${network}` }]);
    }
  });

  it("runs the database package's own statements once it is given the layout", async () => {
    const userId = `${key}-nobody`;
    // Unconfigured, the package names `public`, where the split layout has no tables.
    configureSqlTables(PUBLIC_LAYOUT);
    await expect(
      creditBucketRepository.getBalance(userId, null, models.shared),
    ).rejects.toThrow(/credit_bucket/);

    configureSqlTables(layout);
    expect(
      await creditBucketRepository.getBalance(userId, null, models.shared),
    ).toBe(0n);
    expect(
      await creditBucketRepository.listAvailableBucketsWithBalances(
        userId,
        null,
        models.shared,
      ),
    ).toEqual([]);
  });
});
