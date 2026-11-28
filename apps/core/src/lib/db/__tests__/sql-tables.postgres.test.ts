/**
 * `sharedTable` and `netTable` on the split layout: one statement, written
 * once, lands in the schema of the Network it was built for and nowhere else.
 * Rows are read back through Prisma model clients, which name their schema
 * without the helper. Runs only on the split layout (`onSplitLayout`).
 */
import { randomUUID } from "node:crypto";
import { $Enums } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { backfillTaskWorkTypePresets } from "@sokosumi/database/helpers";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import {
  configureSqlTables,
  createSqlTables,
  type SqlTableLayout,
  type SqlTables,
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
  // Built in `beforeAll`: off the split layout this layout is refused, and the
  // body of a skipped `describe` still runs.
  let tables: SqlTables;
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
    tables = createSqlTables(layout);
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
          WHERE t.typtype = 'e' AND n.nspname = ${schema}`
      )
        .map((row) => row.name)
        .sort();
    const networkEnums = [...networkTables.networkEnums].sort();
    const sharedEnums = Object.keys($Enums)
      .filter((name) => !networkEnums.includes(name))
      .sort();

    expect(await inSchema(layout.mainnet)).toEqual(networkEnums);
    expect(await inSchema(layout.preprod)).toEqual(networkEnums);
    expect(await inSchema(layout.shared)).toEqual(sharedEnums);
  });

  it("casts to the enum type of the schema it names", async () => {
    // Both Networks have an `AgentStatus`; only the type's schema tells them apart.
    // PostgreSQL prints a type outside the search path with its schema.
    const [row] = await models.shared.$queryRaw<Record<string, string>[]>`
      SELECT
        pg_typeof(${"ONLINE"}::${tables.netType("preprod", "AgentStatus")})::text AS preprod,
        pg_typeof(${"ONLINE"}::${tables.netType("mainnet", "AgentStatus")})::text AS mainnet,
        pg_typeof(${"TAG"}::${tables.sharedType("FileLabelKind")})::text AS shared`;
    expect(row).toEqual({
      preprod: `${layout.preprod}."AgentStatus"`,
      mainnet: `${layout.mainnet}."AgentStatus"`,
      shared: `${layout.shared}."FileLabelKind"`,
    });
  });

  // Empty results: the statements resolve on the split layout. Which Network a
  // populated read would return is not shown here; a credit bucket needs a
  // Transaction, whose trigger does not run on this layout before ticket 19.
  it("runs the database package's own statements once it is given the layout", async () => {
    const userId = `${key}-nobody`;
    // Unconfigured, the package names `public`, where the split layout has no tables.
    await expect(
      creditBucketRepository.getNetworkBalance(
        "mainnet",
        userId,
        null,
        models.shared,
      ),
    ).rejects.toThrow(/credit_bucket/);

    onTestFinished(configureSqlTables(layout));
    expect(
      await creditBucketRepository.getNetworkBalance(
        "mainnet",
        userId,
        null,
        models.shared,
      ),
    ).toBe(0n);
    expect(
      await creditBucketRepository.listAvailableBucketsWithBalances(
        "mainnet",
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
