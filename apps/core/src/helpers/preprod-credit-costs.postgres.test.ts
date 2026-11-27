import { convertCentsToCredits } from "@sokosumi/utils";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { recordStatements } from "@/test/record-statements";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

import { calculateCentsFromMasumiAmountStrings } from "./agent-cost";
import {
  PREPROD_CREDIT_COSTS,
  type PreprodScope,
  seedPreprodCreditCosts,
} from "./preprod-credit-costs";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

const TUSDM =
  "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";

describe.runIf(ON_POSTGRES)("Preprod's seeded rates", () => {
  let network: typeof import("@/lib/db/network-scope");
  let prisma: typeof import("@/lib/db/prisma").default;

  beforeAll(async () => {
    vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
    network = await import("@/lib/db/network-scope");
    ({ default: prisma } = await import("@/lib/db/prisma"));
  }, 60_000);

  afterAll(() => vi.unstubAllEnvs());

  const mainnetRows = () =>
    network
      .createNetworkScope("mainnet")
      .networkDb.creditCost.findMany({ orderBy: { id: "asc" } });

  describe("on today's layout, where Preprod's table is Mainnet's", () => {
    it.runIf(!onSplitLayout)(
      "has no Preprod scope, and the seed refuses a scope that claims to be Preprod's",
      async () => {
        expect(() => network.createNetworkScope("preprod")).toThrow(
          "Preprod is off",
        );
        const before = await mainnetRows();
        const claimed = {
          ...network.createNetworkScope("mainnet"),
          network: "preprod",
        } as PreprodScope;
        await expect(seedPreprodCreditCosts(claimed)).rejects.toThrow(
          "Preprod is off",
        );
        expect(await mainnetRows()).toEqual(before);
      },
    );
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    const names = testSchemaNames();
    const mainnetTable = `"${names.DATABASE_SCHEMA_MAINNET}"."CreditCost"`;
    const preprodRows = () =>
      network
        .createNetworkScope("preprod")
        .networkDb.creditCost.findMany({ orderBy: { unit: "asc" } });
    const preprodScope = () =>
      network.createNetworkScope("preprod") as PreprodScope;

    // Every statement that writes Mainnet's table leaves a row here.
    const audit = `"${names.DATABASE_SCHEMA_SHARED}"."c3_rates_mainnet_writes"`;
    beforeAll(async () => {
      // A Mainnet rate of its own, so "unchanged" compares something.
      await network.createNetworkScope("mainnet").networkDb.creditCost.create({
        data: { unit: "c3-mainnet-rate", centsPerUnit: 7n },
      });
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
      await network
        .createNetworkScope("mainnet")
        .networkDb.creditCost.deleteMany({
          where: { unit: "c3-mainnet-rate" },
        });
    });

    afterEach(async () => {
      await network
        .createNetworkScope("preprod")
        .networkDb.creditCost.deleteMany();
      await prisma.$executeRawUnsafe(`DELETE FROM ${audit}`);
    });

    const mainnetWrites = () =>
      prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${audit}`);

    /** The statements and values a Mainnet read sends. */
    async function mainnetReadStatements() {
      const recording = recordStatements();
      try {
        await mainnetRows();
      } finally {
        recording.restore();
      }
      return recording.statements;
    }

    it("writes exactly the two rows, in canonical spelling", async () => {
      await seedPreprodCreditCosts(preprodScope());
      const rows = await preprodRows();
      expect(
        rows.map(({ unit, centsPerUnit }) => ({ unit, centsPerUnit })),
      ).toEqual([
        { unit: TUSDM, centsPerUnit: 1_000_000n },
        { unit: "lovelace", centsPerUnit: 1_000_000n },
      ]);
      expect(PREPROD_CREDIT_COSTS.map(({ unit }) => unit).sort()).toEqual(
        rows.map(({ unit }) => unit).sort(),
      );
    });

    it("changes nothing on Mainnet: rows, writes and a Mainnet read", async () => {
      const rowsBefore = await mainnetRows();
      const readBefore = await mainnetReadStatements();
      await seedPreprodCreditCosts(preprodScope());
      await seedPreprodCreditCosts(preprodScope());
      expect(await mainnetRows()).toEqual(rowsBefore);
      expect(await mainnetWrites()).toEqual([]);
      expect(await mainnetReadStatements()).toEqual(readBefore);
    });

    it("can run again: a row that exists stays as it is, an edit included", async () => {
      await seedPreprodCreditCosts(preprodScope());
      await network.createNetworkScope("preprod").networkDb.creditCost.update({
        where: { unit: "lovelace" },
        data: { centsPerUnit: 5n },
      });
      const before = await preprodRows();
      await seedPreprodCreditCosts(preprodScope());
      expect(await preprodRows()).toEqual(before);
      expect(before.find(({ unit }) => unit === "lovelace")?.centsPerUnit).toBe(
        5n,
      );
    });

    it("refuses a Mainnet scope and writes nothing", async () => {
      const rowsBefore = await mainnetRows();
      expect(rowsBefore).toHaveLength(1);
      const mainnet = network.createNetworkScope("mainnet");
      // @ts-expect-error a Mainnet scope is not a Preprod scope
      const refused = seedPreprodCreditCosts(mainnet);
      await expect(refused).rejects.toThrow("cannot be seeded on mainnet");
      expect(await mainnetRows()).toEqual(rowsBefore);
      expect(await mainnetWrites()).toEqual([]);
      expect(await preprodRows()).toEqual([]);
    });

    it("prices 1 tUSDM and 1 tADA the same, whatever the Agent spells ADA", async () => {
      await seedPreprodCreditCosts(preprodScope());
      const costs = await preprodRows();
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
