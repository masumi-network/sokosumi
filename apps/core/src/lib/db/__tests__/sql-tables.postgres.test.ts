/**
 * `sharedTable` and `netTable` on the split layout: one statement, written
 * once, lands in the schema of the Network it was built for and nowhere else.
 * Rows are read back through Prisma model clients, which name their schema
 * without the helper. Runs only on the split layout (`onSplitLayout`).
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { backfillTaskWorkTypePresets } from "@sokosumi/database/helpers";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import {
  configureSqlTables,
  createSqlTables,
  type SqlTableLayout,
  type TableNetwork,
} from "@sokosumi/database/sql-tables";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";
import networkTables from "../../../../../../packages/database/prisma/network-tables.json" with {
  type: "json",
};

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

  it("finds each enum type in the schema the list gives it", async () => {
    const inSchema = async (schema: string) =>
      (
        await models.shared.$queryRaw<{ name: string }[]>`
          SELECT t.typname AS name FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typtype = 'e' AND n.nspname = ${schema}
          ORDER BY t.typname`
      ).map((row) => row.name);
    const networkEnums = [...networkTables.networkEnums].sort();
    const sharedEnums = await inSchema(layout.shared);

    expect((await inSchema(layout.mainnet)).sort()).toEqual(networkEnums);
    expect((await inSchema(layout.preprod)).sort()).toEqual(networkEnums);
    expect(sharedEnums.length).toBeGreaterThan(0);
    expect(sharedEnums.filter((name) => networkEnums.includes(name))).toEqual(
      [],
    );
    // Every shared enum is one `sharedType` accepts.
    for (const name of sharedEnums) tables.sharedType(name);

    const [row] = await models.shared.$queryRaw<{ a: string; b: string }[]>`
      SELECT ${"ONLINE"}::${tables.netType("preprod", "AgentStatus")}::text AS a,
             ${"TAG"}::${tables.sharedType("FileLabelKind")}::text AS b`;
    expect(row).toEqual({ a: "ONLINE", b: "TAG" });
  });

  // Empty results: the statements resolve on the split layout. Which Network a
  // populated read would return is not shown here; a credit bucket needs a
  // Transaction, whose trigger does not run on this layout before ticket 19.
  it("runs the database package's own statements once it is given the layout", async () => {
    const userId = `${key}-nobody`;
    // Unconfigured, the package names `public`, where the split layout has no tables.
    await expect(
      creditBucketRepository.getBalance(userId, null, models.shared),
    ).rejects.toThrow(/credit_bucket/);

    onTestFinished(configureSqlTables(layout));
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

  it("casts to an enum in its schema: the presets backfill's dry run", async () => {
    onTestFinished(configureSqlTables(layout));
    const missing = await backfillTaskWorkTypePresets(models.shared, {
      dryRun: true,
    });
    expect(missing).toBeGreaterThanOrEqual(0);
  });
});
