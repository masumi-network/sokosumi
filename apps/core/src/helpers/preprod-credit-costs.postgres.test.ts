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
const OWN_MAINNET_UNIT = "c3-mainnet-rate";

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

  describe.runIf(onSplitLayout)("on the split layout", () => {
    const names = testSchemaNames();
    const mainnetTable = `"${names.DATABASE_SCHEMA_MAINNET}"."CreditCost"`;
    const audit = `"${names.DATABASE_SCHEMA_SHARED}"."c3_rates_mainnet_writes"`;
    const preprod = () => network.createNetworkScope("preprod").networkDb;
    /** Rows in Preprod's table before this suite: never ours to remove. */
    let baselineIds: string[] = [];

    const mainnetWrites = () =>
      prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${audit}`);
    const seededRows = () =>
      preprod().creditCost.findMany({
        where: { unit: { in: SEEDED_UNITS } },
        orderBy: { unit: "asc" },
      });

    beforeAll(async () => {
      baselineIds = (
        await preprod().creditCost.findMany({ select: { id: true } })
      ).map(({ id }) => id);
      // A Mainnet rate of its own, so "unchanged" compares something.
      await mainnet().creditCost.deleteMany({
        where: { unit: OWN_MAINNET_UNIT },
      });
      await mainnet().creditCost.create({
        data: { unit: OWN_MAINNET_UNIT, centsPerUnit: 7n },
      });
      // Every statement that writes Mainnet's table leaves a row here.
      await prisma.$executeRawUnsafe(
        `CREATE TABLE ${audit} (statement text NOT NULL)`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${names.DATABASE_SCHEMA_SHARED}"."c3_rates_audit"() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN INSERT INTO ${audit} VALUES (TG_OP); RETURN NULL; END $$`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER c3_rates_audit AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
        ON ${mainnetTable} FOR EACH STATEMENT
        EXECUTE FUNCTION "${names.DATABASE_SCHEMA_SHARED}"."c3_rates_audit"()`);
    }, 60_000);

    afterAll(async () => {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS c3_rates_audit ON ${mainnetTable}`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS "${names.DATABASE_SCHEMA_SHARED}"."c3_rates_audit"()`,
      );
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${audit}`);
      await mainnet().creditCost.deleteMany({
        where: { unit: OWN_MAINNET_UNIT },
      });
    });

    // Removes only rows the seed made here: ids that were not there before.
    afterEach(async () => {
      await preprod().creditCost.deleteMany({
        where: { id: { notIn: baselineIds }, unit: { in: SEEDED_UNITS } },
      });
      await prisma.$executeRawUnsafe(`DELETE FROM ${audit}`);
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
      let run: Awaited<ReturnType<typeof recorded>>;
      try {
        run = await recorded(() => seedPreprodCreditCosts());
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER SCHEMA "${away}" RENAME TO "${names.DATABASE_SCHEMA_MAINNET}"`,
        );
      }
      expect(run.error).toBeUndefined();
      // The seed's own SQL and bindings: reads and writes name Preprod only.
      expect(run.statements.length).toBeGreaterThan(0);
      expect(await seededRows()).toHaveLength(2);
    });

    it("changes nothing on Mainnet: rows, writes, and a mounted GET's SQL, bindings and answer", async () => {
      const rowsBefore = await mainnetRows();
      const getBefore = await mainnetGet();
      expect(getBefore.statements.length).toBeGreaterThan(0);
      await seedPreprodCreditCosts();
      await seedPreprodCreditCosts();
      expect(await mainnetRows()).toEqual(rowsBefore);
      expect(await mainnetWrites()).toEqual([]);
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
        const second = await recorded(() => seedPreprodCreditCosts());
        expect(second.error).toBeUndefined();
        expect(await seededRows()).toEqual(before);
        expect(
          before.find(({ unit }) => unit === "lovelace")?.centsPerUnit,
        ).toBe(5n);
        // Nothing is missing, so the run sends only the read.
        expect(
          second.statements.filter(({ text }) => /insert/i.test(text)),
        ).toEqual([]);
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

    it("ignores a scope another caller hands it: a Mainnet scope labeled Preprod writes Mainnet nothing", async () => {
      const rowsBefore = await mainnetRows();
      const mislabeled = {
        ...network.createNetworkScope("mainnet"),
        network: "preprod",
      };
      // @ts-expect-error the seed takes no scope
      await seedPreprodCreditCosts(mislabeled);
      expect(await mainnetRows()).toEqual(rowsBefore);
      expect(await mainnetWrites()).toEqual([]);
      expect(await seededRows()).toHaveLength(2);
    });

    it("refuses while Preprod is off, before any statement", async () => {
      const env = await import("@/config/env");
      const real = env.getEnv();
      const off = vi
        .spyOn(env, "getEnv")
        .mockReturnValue({ ...real, NETWORK_PREPROD_ENABLED: false });
      try {
        const rowsBefore = await mainnetRows();
        const refusal = await recorded(() => seedPreprodCreditCosts());
        expect(String(refusal.error)).toContain("Preprod is off");
        expect(refusal.statements).toEqual([]);
        expect(await mainnetRows()).toEqual(rowsBefore);
        expect(await mainnetWrites()).toEqual([]);
      } finally {
        off.mockRestore();
      }
    });

    it("prices 1 tUSDM and 1 tADA the same, whatever the Agent spells ADA", async () => {
      await seedPreprodCreditCosts();
      const costs = await seededRows();
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
  });
});
