/**
 * Preprod on the new layout: each Network client writes only its own schema,
 * and Preprod's rows outlive switching Preprod off and on again. Runs only on
 * the split layout (`onSplitLayout`), which CI's `Test Core PostgreSQL split
 * layout` job builds.
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient, PrismaRaw } from "@sokosumi/database/client";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";
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

type Clients = typeof import("./prisma");

const key = `n56-${randomUUID().slice(0, 12)}`;

/**
 * Core's database module as a fresh start with the flag set this way loads it:
 * no cached clients, a new pool (`afterAll` ends every pool).
 */
async function start(preprod: "true" | "false"): Promise<Clients> {
  delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
  vi.resetModules();
  vi.stubEnv("NETWORK_PREPROD_ENABLED", preprod);
  return import("./prisma");
}

describe.runIf(onSplitLayout)("Preprod on the split layout", () => {
  const schemas: Record<Network, string> = {
    mainnet: testSchemaNames().DATABASE_SCHEMA_MAINNET,
    preprod: testSchemaNames().DATABASE_SCHEMA_PREPROD,
  };
  let admin: ReturnType<typeof createPrismaClient>;
  let clients: Clients | undefined;

  /** The tag names stored in one schema, read past every Core client. */
  async function storedIn(network: Network, prefix: string) {
    const rows = await admin.$queryRaw<{ name: string }[]>`
      SELECT name FROM ${PrismaRaw.raw(`"${schemas[network]}"."Tag"`)}
      WHERE name LIKE ${`${prefix}%`} ORDER BY name`;
    return rows.map((row) => row.name);
  }

  async function readThrough(network: Network, prefix: string) {
    if (!clients) throw new Error("Core's database module is not loaded");
    const tags = await clients.networkPrisma(network).tag.findMany({
      where: { name: { startsWith: prefix } },
      orderBy: { name: "asc" },
    });
    return tags.map((tag) => tag.name);
  }

  beforeAll(() => {
    admin = createPrismaClient(process.env.DATABASE_URL ?? "");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    for (const schema of Object.values(schemas)) {
      await admin.$executeRaw`
        DELETE FROM ${PrismaRaw.raw(`"${schema}"."Tag"`)}
        WHERE name LIKE ${`${key}%`}`;
    }
    await admin.$disconnect();
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("keeps a write through each Network client in that Network's schema", async () => {
    const prefix = `${key}:write`;
    clients = await start("true");
    await clients
      .networkPrisma("preprod")
      .tag.create({ data: { name: `${prefix}:preprod` } });
    await clients
      .networkPrisma("mainnet")
      .tag.create({ data: { name: `${prefix}:mainnet` } });

    expect(await readThrough("preprod", prefix)).toEqual([`${prefix}:preprod`]);
    expect(await readThrough("mainnet", prefix)).toEqual([`${prefix}:mainnet`]);
    expect(await storedIn("preprod", prefix)).toEqual([`${prefix}:preprod`]);
    expect(await storedIn("mainnet", prefix)).toEqual([`${prefix}:mainnet`]);
  });

  it("keeps Preprod's rows and leaves Mainnet unchanged when Preprod goes off and on again", async () => {
    const prefix = `${key}:switch`;
    clients = await start("true");
    await clients.networkPrisma("preprod").tag.createMany({
      data: [{ name: `${prefix}:preprod-1` }, { name: `${prefix}:preprod-2` }],
    });
    await clients
      .networkPrisma("mainnet")
      .tag.create({ data: { name: `${prefix}:mainnet` } });
    const mainnetBefore = await readThrough("mainnet", prefix);

    clients = await start("false");
    expect(await readThrough("mainnet", prefix)).toEqual(mainnetBefore);
    expect(() => clients?.networkPrisma("preprod")).toThrow("Preprod is off");

    clients = await start("true");
    expect(await readThrough("preprod", prefix)).toEqual([
      `${prefix}:preprod-1`,
      `${prefix}:preprod-2`,
    ]);
    expect(await readThrough("mainnet", prefix)).toEqual(mainnetBefore);
  });
});
