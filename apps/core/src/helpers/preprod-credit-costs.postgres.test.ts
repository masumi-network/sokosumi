import { randomUUID } from "node:crypto";
import { convertCentsToCredits } from "@sokosumi/utils";
import { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

import { calculateCentsFromMasumiAmountStrings } from "./agent-cost";
import {
  PREPROD_CREDIT_COSTS,
  seedPreprodCreditCosts,
} from "./preprod-credit-costs";

// Before any import reads the environment: the mocked auth module loads Core's.
await vi.hoisted(async () => {
  const { isSplitLayout } = await import("@/test/split-layout-pending");
  vi.stubEnv(
    "NETWORK_PREPROD_ENABLED",
    isSplitLayout(process.env) ? "true" : "false",
  );
});

// Sets the context where production does; the route's admin guard stays real.
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const authMiddleware: typeof actual.authMiddleware = async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: randomUUID(),
      organizationId: null,
      role: "admin",
      authenticationMethod: "session",
    });
    await next();
  };
  return { ...actual, authMiddleware };
});

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

const TUSDM =
  "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
const SEEDED_UNITS = [TUSDM, "lovelace"];

/** Every statement the pool's connections send: SQL text and bindings. */
function recordSql() {
  const statements: { text: string; values: unknown[] }[] = [];
  const query = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
    this: Client,
    ...args: unknown[]
  ) {
    const [first, second] = args as [unknown, unknown];
    const config =
      typeof first === "object" && first !== null
        ? (first as { text?: string; values?: unknown[] })
        : { text: first as string, values: second as unknown[] | undefined };
    statements.push({
      text: String(config.text),
      values: Array.isArray(config.values) ? config.values : [],
    });
    return (query as (...a: unknown[]) => unknown).apply(this, args);
  } as never);
  return { statements, restore: () => spy.mockRestore() };
}

async function recorded(run: () => Promise<unknown>) {
  const recording = recordSql();
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  } finally {
    recording.restore();
  }
  return { statements: recording.statements, error };
}

describe.runIf(ON_POSTGRES)("Preprod's seeded rates", () => {
  let network: typeof import("@/lib/db/network-scope");
  let prisma: typeof import("@/lib/db/prisma").default;
  let OpenAPIHonoWithAuth: typeof import("@/lib/hono").OpenAPIHonoWithAuth;
  let mountGet: typeof import("@/routes/v1/credit-costs/get").default;

  beforeAll(async () => {
    vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
    network = await import("@/lib/db/network-scope");
    ({ default: prisma } = await import("@/lib/db/prisma"));
    ({ OpenAPIHonoWithAuth } = await import("@/lib/hono"));
    ({ default: mountGet } = await import("@/routes/v1/credit-costs/get"));
  }, 60_000);

  afterAll(() => vi.unstubAllEnvs());

  const mainnet = () => network.createNetworkScope("mainnet").networkDb;
  const mainnetRows = () =>
    mainnet().creditCost.findMany({ orderBy: { id: "asc" } });

  /** A real mounted `GET /v1/credit-costs` on Mainnet: SQL, bindings, answer. */
  async function mainnetGet() {
    const app = new OpenAPIHonoWithAuth();
    mountGet(app);
    let body: unknown;
    const { statements, error } = await recorded(async () => {
      const response = await app.request("http://localhost/");
      expect(response.status).toBe(200);
      body = ((await response.json()) as { data: unknown }).data;
    });
    expect(error).toBeUndefined();
    return { statements, body };
  }

  describe.runIf(!onSplitLayout)(
    "on today's layout, where Preprod's table is Mainnet's",
    () => {
      it("has no Preprod scope, and the seed sends no statement and writes nothing", async () => {
        expect(() => network.createNetworkScope("preprod")).toThrow(
          "Preprod is off",
        );
        const before = await mainnetRows();
        const getBefore = await mainnetGet();
        const refusal = await recorded(() => seedPreprodCreditCosts());
        expect(String(refusal.error)).toContain("Preprod is off");
        expect(refusal.statements).toEqual([]);
        expect(await mainnetRows()).toEqual(before);
        expect(await mainnetGet()).toEqual(getBefore);
      });
    },
  );

  // The declared defaults, not whatever the table holds (an admin may have
  // edited a row there): the persisted rows are checked by the missing-row test.
  it("prices 1 tUSDM and 1 tADA the same with the declared rates, whatever the Agent spells ADA", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const costs = PREPROD_CREDIT_COSTS.map((cost) => ({
      ...cost,
      id: cost.unit,
      createdAt: at,
      updatedAt: at,
    }));
    const cents = (unit: string) =>
      calculateCentsFromMasumiAmountStrings(
        [{ unit, amount: "1000000" }],
        costs,
      );
    expect(cents(TUSDM)).toBe(10n ** 12n);
    for (const ada of ["lovelace", "", "LOVELACE", " lovelace "]) {
      expect(cents(ada)).toBe(cents(TUSDM));
    }
    expect(convertCentsToCredits(cents("lovelace"))).toBe(100);
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    const names = testSchemaNames();
    // Unique per run: nothing here can meet an object it did not create.
    const run = randomUUID().replaceAll("-", "").slice(0, 12);
    const ownMainnetUnit = `c3-mainnet-rate-${run}`;
    const shared = `"${names.DATABASE_SCHEMA_SHARED}"`;
    const auditTable = `${shared}."c3_rates_${run}_writes"`;
    const auditFunction = `${shared}."c3_rates_${run}_audit"`;
    const triggerName = `"c3_rates_${run}_trg"`;
    const tables = {
      mainnet: `"${names.DATABASE_SCHEMA_MAINNET}"."CreditCost"`,
      preprod: `"${names.DATABASE_SCHEMA_PREPROD}"."CreditCost"`,
    } as const;
    const preprod = () => network.createNetworkScope("preprod").networkDb;
    /** Rows in Preprod's table before this suite: never ours to remove. */
    let baselineIds: string[] = [];
    /** Mainnet's rows before any write of this suite. */
    let mainnetBaseline: Awaited<ReturnType<typeof mainnetRows>> = [];
    let fixtureId: string | undefined;
    const created = { table: false, function: false, triggers: [] as string[] };

    /** What the suite's triggers recorded: `network`, `op`. */
    const writes = (net: "mainnet" | "preprod") =>
      prisma.$queryRawUnsafe<{ op: string }[]>(
        `SELECT op FROM ${auditTable} WHERE network = '${net}'`,
      );
    /** Mainnet's rows without the suite's own fixture. */
    const mainnetWithoutFixture = async () =>
      (await mainnetRows()).filter(({ id }) => id !== fixtureId);
    const seededRows = () =>
      preprod().creditCost.findMany({
        where: { unit: { in: SEEDED_UNITS } },
        orderBy: { unit: "asc" },
      });

    beforeAll(async () => {
      // Before any write of this suite.
      mainnetBaseline = await mainnetRows();
      baselineIds = (
        await preprod().creditCost.findMany({ select: { id: true } })
      ).map(({ id }) => id);
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${auditTable} (network text NOT NULL, op text NOT NULL)`,
      );
      created.table = true;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION ${auditFunction}() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ${auditTable} VALUES (TG_ARGV[0], TG_OP); RETURN NULL; END $$`);
      created.function = true;
      for (const [net, table] of Object.entries(tables)) {
        // Mainnet: every write. Preprod: inserts only.
        const events =
          net === "mainnet"
            ? "INSERT OR UPDATE OR DELETE OR TRUNCATE"
            : "INSERT";
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER ${triggerName} AFTER ${events} ON ${table}
          FOR EACH STATEMENT EXECUTE FUNCTION ${auditFunction}('${net}')`);
        created.triggers.push(table);
      }
      // A Mainnet rate of its own, so "unchanged" compares something.
      fixtureId = (
        await mainnet().creditCost.create({
          data: { unit: ownMainnetUnit, centsPerUnit: 7n },
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      if (fixtureId) {
        await mainnet().creditCost.deleteMany({ where: { id: fixtureId } });
      }
      for (const table of created.triggers) {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`,
        );
      }
      if (created.function) {
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS ${auditFunction}()`,
        );
      }
      if (created.table) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${auditTable}`);
      }
    });

    // Removes only rows the seed made here: ids that were not there before.
    afterEach(async () => {
      await preprod().creditCost.deleteMany({
        where: { id: { notIn: baselineIds }, unit: { in: SEEDED_UNITS } },
      });
      await prisma.$executeRawUnsafe(`DELETE FROM ${auditTable}`);
    });

    it("adds exactly the missing rows to what was there, in canonical spelling", async () => {
      const before = await preprod().creditCost.findMany({
        orderBy: { id: "asc" },
      });
      const had = new Set(before.map(({ unit }) => unit));
      await seedPreprodCreditCosts();
      const after = await preprod().creditCost.findMany({
        orderBy: { id: "asc" },
      });
      const beforeIds = new Set(before.map(({ id }) => id));
      const added = after.filter(({ id }) => !beforeIds.has(id));
      expect(added.map(({ unit }) => unit).sort()).toEqual(
        SEEDED_UNITS.filter((unit) => !had.has(unit)).sort(),
      );
      expect(after.filter(({ id }) => beforeIds.has(id))).toEqual(before);
      for (const row of added) expect(row.centsPerUnit).toBe(1_000_000n);
      // Both rows exist now, whoever made them.
      expect((await seededRows()).map(({ unit }) => unit).sort()).toEqual(
        [...SEEDED_UNITS].sort(),
      );
      expect(PREPROD_CREDIT_COSTS.map(({ unit }) => unit).sort()).toEqual(
        [...SEEDED_UNITS].sort(),
      );
    });

    it("sends no statement on Mainnet's tables: PostgreSQL refuses one with Mainnet's schema away", async () => {
      const away = `${names.DATABASE_SCHEMA_MAINNET}_away_${randomUUID().slice(0, 8)}`;
      await prisma.$executeRawUnsafe(
        `ALTER SCHEMA "${names.DATABASE_SCHEMA_MAINNET}" RENAME TO "${away}"`,
      );
      let result: Awaited<ReturnType<typeof recorded>>;
      let rerun: Awaited<ReturnType<typeof recorded>>;
      try {
        // The first run inserts what is missing; the second is the rerun path.
        result = await recorded(() => seedPreprodCreditCosts());
        rerun = await recorded(() => seedPreprodCreditCosts());
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER SCHEMA "${away}" RENAME TO "${names.DATABASE_SCHEMA_MAINNET}"`,
        );
      }
      expect(result.error).toBeUndefined();
      expect(rerun.error).toBeUndefined();
      expect(result.statements.length).toBeGreaterThan(0);
      expect(rerun.statements.length).toBeGreaterThan(0);
      expect(await seededRows()).toHaveLength(2);
    });

    it("changes nothing on Mainnet: rows, writes, and a mounted GET's SQL, bindings and answer", async () => {
      const getBefore = await mainnetGet();
      expect(getBefore.statements.length).toBeGreaterThan(0);
      await seedPreprodCreditCosts();
      await seedPreprodCreditCosts();
      // What was there before this suite wrote anything, and the same GET.
      expect(await mainnetWithoutFixture()).toEqual(mainnetBaseline);
      expect(await writes("mainnet")).toEqual([]);
      expect(await mainnetGet()).toEqual(getBefore);
    });

    it("can run again: rows that exist stay as they are, an edit included, and nothing is inserted", async () => {
      await seedPreprodCreditCosts();
      const original = (await seededRows()).find(
        ({ unit }) => unit === "lovelace",
      );
      expect(original).toBeDefined();
      await preprod().creditCost.update({
        where: { unit: "lovelace" },
        data: { centsPerUnit: 5n },
      });
      try {
        const before = await seededRows();
        await prisma.$executeRawUnsafe(`DELETE FROM ${auditTable}`);
        await seedPreprodCreditCosts();
        expect(await seededRows()).toEqual(before);
        expect(
          before.find(({ unit }) => unit === "lovelace")?.centsPerUnit,
        ).toBe(5n);
        // Nothing is missing: PostgreSQL saw no insert statement on the table.
        expect(await writes("preprod")).toEqual([]);
      } finally {
        // A lovelace row an admin made before this suite gets its value back.
        if (original && baselineIds.includes(original.id)) {
          await preprod().creditCost.update({
            where: { unit: "lovelace" },
            data: {
              centsPerUnit: original.centsPerUnit,
              updatedAt: original.updatedAt,
            },
          });
        }
      }
    });

    it("two seeds at once, on two connections, both finish and leave one row per unit", async (context) => {
      const have = new Set((await seededRows()).map(({ unit }) => unit));
      if (SEEDED_UNITS.every((unit) => have.has(unit))) {
        // Nothing is missing, so nothing can race.
        context.skip();
      }
      // A third connection holds a lock that lets the seeds read and blocks
      // their inserts, so both have read "missing" before either writes.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      let held = false;
      try {
        await holder.query("BEGIN");
        await holder.query(`LOCK TABLE ${tables.preprod} IN SHARE MODE`);
        held = true;
        const both = Promise.allSettled([
          seedPreprodCreditCosts(),
          seedPreprodCreditCosts(),
        ]);
        const waiting = async () =>
          Number(
            (
              await holder.query(
                `SELECT count(DISTINCT pid)::int AS n FROM pg_locks
                 WHERE relation = to_regclass($1)
                   AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
                   AND mode = 'RowExclusiveLock' AND NOT granted`,
                [tables.preprod],
              )
            ).rows[0].n,
          );
        await vi.waitFor(async () => expect(await waiting()).toBe(2), {
          timeout: 15_000,
          interval: 50,
        });
        await holder.query("COMMIT");
        held = false;
        const results = await both;
        expect(results.map(({ status }) => status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
      } finally {
        if (held) await holder.query("ROLLBACK");
        await holder.end();
      }
      const rows = await seededRows();
      expect(rows.map(({ unit }) => unit).sort()).toEqual(
        [...SEEDED_UNITS].sort(),
      );
    }, 60_000);

    it("ignores a scope another caller hands it: a Mainnet scope labeled Preprod writes Mainnet nothing", async () => {
      const mislabeled = {
        ...network.createNetworkScope("mainnet"),
        network: "preprod",
      };
      // @ts-expect-error the seed takes no scope
      await seedPreprodCreditCosts(mislabeled);
      expect(await mainnetWithoutFixture()).toEqual(mainnetBaseline);
      expect(await writes("mainnet")).toEqual([]);
      expect(await seededRows()).toHaveLength(2);
    });

    it("refuses while Preprod is off, before any statement", async () => {
      const env = await import("@/config/env");
      const real = env.getEnv();
      const off = vi
        .spyOn(env, "getEnv")
        .mockReturnValue({ ...real, NETWORK_PREPROD_ENABLED: false });
      try {
        const refusal = await recorded(() => seedPreprodCreditCosts());
        expect(String(refusal.error)).toContain("Preprod is off");
        expect(refusal.statements).toEqual([]);
        expect(await mainnetWithoutFixture()).toEqual(mainnetBaseline);
        expect(await writes("mainnet")).toEqual([]);
      } finally {
        off.mockRestore();
      }
    });
  });
});
