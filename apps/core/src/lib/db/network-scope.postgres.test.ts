/**
 * A Network scope on a real PostgreSQL: what it hands out, and on the split
 * layout (`onSplitLayout`) that each scope reads its own Network's schema.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/db/network-scope.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { NETWORKS, type Network } from "@/lib/network";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

const pools = vi.hoisted(() => [] as Pool[]);
vi.mock("@vercel/functions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/functions")>();
  return {
    ...actual,
    attachDatabasePool: (pool: Pool) => {
      pools.push(pool);
      actual.attachDatabasePool(pool);
    },
  };
});
// setup.ts mocks this module for every file; its factory result survives
// vi.resetModules(), so a reload with the flag changed would keep the first.
vi.unmock("@/lib/db/prisma");

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

const id = randomUUID();
const name = (network: Network) => `n58-${id}:${network}`;

/** Core's database module and the scope module, as a fresh start loads them. */
async function start(preprod?: "true" | "false") {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.stubEnv("NETWORK_PREPROD_ENABLED", preprod);
  const { createNetworkScope } = await import("./network-scope");
  return { createNetworkScope, clients: await import("./prisma") };
}

describe.runIf(enabled)("Network scope on PostgreSQL", () => {
  // Past Core's clients: one per Network schema that holds the row.
  const admins: Partial<
    Record<Network, ReturnType<typeof createPrismaClient>>
  > = {};

  beforeAll(async () => {
    const schemas = testSchemaNames();
    const seeded: Record<Network, string | false> = {
      mainnet: schemas.DATABASE_SCHEMA_MAINNET,
      preprod: onSplitLayout && schemas.DATABASE_SCHEMA_PREPROD,
    };
    for (const network of NETWORKS) {
      const schema = seeded[network];
      if (!schema) continue;
      const admin = createPrismaClient(url ?? "", { schema });
      admins[network] = admin;
      await admin.tag.create({ data: { id, name: name(network) } });
    }
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const admin of Object.values(admins)) {
      await admin.tag.deleteMany({ where: { id } });
      await admin.$disconnect();
    }
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("hands out the Mainnet client itself and the default client", async () => {
    const { createNetworkScope, clients } = await start();

    const scope = createNetworkScope("mainnet");

    expect(scope.networkDb).toBe(clients.networkPrisma("mainnet"));
    expect(scope.sharedDb).toBe(clients.default);
    const tag = await scope.networkDb.tag.findUnique({ where: { id } });
    expect(tag?.name).toBe(name("mainnet"));
  });

  it("commits a Network transaction and rolls one back", async () => {
    const { createNetworkScope } = await start();
    const scope = createNetworkScope("mainnet");
    const kept = randomUUID();
    const undone = randomUUID();
    onTestFinished(async () => {
      await admins.mainnet?.tag.deleteMany({ where: { id: kept } });
    });

    await scope.netTransaction(
      (tx) => tx.tag.create({ data: { id: kept, name: `n60-${kept}` } }),
      "Tag conflict",
    );
    await expect(
      scope.netTransaction(async (tx) => {
        await tx.tag.create({ data: { id: undone, name: `n60-${undone}` } });
        throw new Error("undo");
      }, "Tag conflict"),
    ).rejects.toThrow("undo");

    const tags = await admins.mainnet?.tag.findMany({
      where: { id: { in: [kept, undone] } },
      select: { id: true },
    });
    expect(tags).toEqual([{ id: kept }]);
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    it("writes in a transaction to its own Network only", async () => {
      const { createNetworkScope } = await start("true");
      const written = randomUUID();
      onTestFinished(async () => {
        for (const admin of Object.values(admins))
          await admin.tag.deleteMany({ where: { id: written } });
      });

      for (const network of NETWORKS) {
        await createNetworkScope(network).netTransaction(
          (tx) =>
            tx.tag.create({
              data: { id: written, name: `n60-${written}:${network}` },
            }),
          "Tag conflict",
        );
      }

      for (const network of NETWORKS) {
        const own = await admins[network]?.tag.findUnique({
          where: { id: written },
        });
        expect(own?.name).toBe(`n60-${written}:${network}`);
      }
    });

    it("reads one id per scope without mixing the Networks", async () => {
      const { createNetworkScope } = await start("true");

      for (const network of NETWORKS) {
        const scope = createNetworkScope(network);

        const tag = await scope.networkDb.tag.findUnique({ where: { id } });
        const rows = await scope.networkDb.$queryRaw<{ name: string }[]>`
          SELECT name FROM ${scope.networkTable("Tag")} WHERE id = ${id}`;
        expect(scope.network).toBe(network);
        expect(tag?.name).toBe(name(network));
        expect(rows).toEqual([{ name: name(network) }]);
      }
    });

    it("reads a batch on its own Network, in one snapshot", async () => {
      const { createNetworkScope } = await start("true");

      for (const network of NETWORKS) {
        const [tag, count] = await createNetworkScope(network).netBatch(
          (db) => [
            db.tag.findUnique({ where: { id } }),
            db.tag.count({ where: { id } }),
          ],
          "RepeatableRead",
        );
        expect([network, tag?.name, count]).toEqual([
          network,
          name(network),
          1,
        ]);
      }
    });

    it("refuses a Preprod scope while Preprod is off", async () => {
      const { createNetworkScope } = await start("false");

      expect(() => createNetworkScope("preprod")).toThrow("Preprod is off");
      const scope = createNetworkScope("mainnet");
      const tag = await scope.networkDb.tag.findUnique({ where: { id } });
      expect(tag?.name).toBe(name("mainnet"));
    });
  });
});
