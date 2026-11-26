import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  attachedPools: [] as Pool[],
  captureException: vi.fn(),
  createPrismaClient: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  attachDatabasePool: (pool: Pool) => {
    mocks.attachedPools.push(pool);
    mocks.attachDatabasePool(pool);
  },
}));
// setup.ts mocks this module for every file; its factory result survives
// vi.resetModules(), so the module would never be evaluated again.
vi.unmock("@/lib/db/prisma");
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureException: mocks.captureException,
}));
vi.mock("@sokosumi/database/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/client")>();
  mocks.createPrismaClient.mockImplementation(actual.createPrismaClient);
  return { ...actual, createPrismaClient: mocks.createPrismaClient };
});

const EMPTY_RESULT = {
  command: "SELECT",
  rowCount: 0,
  oid: 0,
  fields: [],
  rows: [],
};
const SCHEMA_VARIABLES = [
  "DATABASE_SCHEMA_SHARED",
  "DATABASE_SCHEMA_MAINNET",
  "DATABASE_SCHEMA_PREPROD",
  "NETWORK_PREPROD_ENABLED",
] as const;
/** The split layout with Preprod on: every client can be obtained. */
const PREPROD_ON = {
  DATABASE_SCHEMA_SHARED: "shared",
  DATABASE_SCHEMA_MAINNET: "mainnet",
  DATABASE_SCHEMA_PREPROD: "preprod",
  NETWORK_PREPROD_ENABLED: "true",
} as const;

const cache = globalThis as { coreDatabase?: unknown };
const cachedByOtherFiles = cache.coreDatabase;

async function importClients() {
  vi.resetModules();
  return await import("./prisma");
}

/** A fresh database module; every schema name and the flag are unset unless given. */
async function loadClients(
  schemas: Partial<Record<(typeof SCHEMA_VARIABLES)[number], string>> = {},
) {
  delete cache.coreDatabase;
  for (const name of SCHEMA_VARIABLES) vi.stubEnv(name, schemas[name]);
  mocks.attachDatabasePool.mockClear();
  mocks.attachedPools.length = 0;
  mocks.createPrismaClient.mockClear();
  const module = await importClients();
  // The attached instance itself, not `instanceof`: a module reset can load
  // another copy of `pg`, whose Pool class is a different object.
  const [pool, ...others] = mocks.attachedPools;
  if (!pool || others.length > 0) {
    throw new Error(
      `Expected one attached pool, got ${mocks.attachedPools.length}`,
    );
  }
  // Spying on that instance: a client with its own pool would reach the
  // network and fail, not land in this spy.
  const query = vi
    .spyOn(pool, "query")
    .mockImplementation(() => Promise.resolve(EMPTY_RESULT));
  return { ...module, query, pool };
}

async function lockSql(
  client: { lock: { findFirst: (args: object) => Promise<unknown> } },
  query: ReturnType<typeof vi.spyOn>,
) {
  query.mockClear();
  await client.lock.findFirst({ where: { key: "k" } });
  return firstSql(query);
}

function firstSql(query: ReturnType<typeof vi.spyOn>) {
  const calls: unknown[][] = query.mock.calls;
  const config = calls[0]?.[0] as string | { text: string } | undefined;
  return typeof config === "string" ? config : config?.text;
}

afterEach(() => {
  cache.coreDatabase = cachedByOtherFiles;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.captureException.mockClear();
});

describe("Core database clients", () => {
  it("sends every client's queries through the one attached pool", async () => {
    const {
      default: prisma,
      networkPrisma,
      query,
      pool,
    } = await loadClients(PREPROD_ON);

    const clients = [
      prisma,
      networkPrisma("mainnet"),
      networkPrisma("preprod"),
    ];
    expect(new Set(clients).size).toBe(3);
    for (const client of clients) {
      await lockSql(client, query);
      expect(query.mock.contexts).toEqual([pool]);
    }
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
    expect(pool.options.max).toBe(10);
  });

  it("builds a Network's client on first use and keeps it across a module reload", async () => {
    const {
      default: prisma,
      networkPrisma,
      pool,
    } = await loadClients(PREPROD_ON);
    expect(mocks.createPrismaClient).toHaveBeenCalledTimes(1);

    const mainnet = networkPrisma("mainnet");
    expect(networkPrisma("mainnet")).toBe(mainnet);
    expect(mocks.createPrismaClient).toHaveBeenCalledTimes(2);
    const preprod = networkPrisma("preprod");
    expect(mocks.createPrismaClient).toHaveBeenCalledTimes(3);
    for (const [usedPool] of mocks.createPrismaClient.mock.calls) {
      expect(usedPool).toBe(pool);
    }

    const reloaded = await importClients();
    expect(reloaded.default).toBe(prisma);
    expect(reloaded.networkPrisma("mainnet")).toBe(mainnet);
    expect(reloaded.networkPrisma("preprod")).toBe(preprod);
    expect(mocks.createPrismaClient).toHaveBeenCalledTimes(3);
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the cached clients when a reload brings other schema names", async () => {
    const { networkPrisma } = await loadClients();
    networkPrisma("mainnet");
    for (const [name, value] of Object.entries(PREPROD_ON)) {
      vi.stubEnv(name, value);
    }
    mocks.attachedPools.length = 0;

    const reloaded = await importClients();
    const [pool] = mocks.attachedPools;
    if (!pool) throw new Error("Expected a new pool for the new layout");
    const query = vi
      .spyOn(pool, "query")
      .mockImplementation(() => Promise.resolve(EMPTY_RESULT));

    expect(await lockSql(reloaded.networkPrisma("preprod"), query)).toContain(
      '"preprod"."Lock"',
    );
    expect(await lockSql(reloaded.networkPrisma("mainnet"), query)).toContain(
      '"mainnet"."Lock"',
    );
  });

  it.each([undefined, "Mainnet", "Preprod", "", "toString", "__proto__"])(
    "throws on %s before it builds or caches a client",
    async (value) => {
      const { networkPrisma } = await loadClients();

      expect(() => networkPrisma(value as Network)).toThrow("Unknown Network");

      expect(mocks.createPrismaClient).toHaveBeenCalledTimes(1);
      networkPrisma("mainnet");
      expect(mocks.createPrismaClient).toHaveBeenCalledTimes(2);
    },
  );

  it("names today's public schema in the shared and Mainnet queries by default", async () => {
    const { default: prisma, networkPrisma, query } = await loadClients();

    for (const client of [prisma, networkPrisma("mainnet")]) {
      expect(await lockSql(client, query)).toContain('"public"."Lock"');
    }
  });

  it("sends the credit costs read as the same query through the Mainnet client as through the default client, on today's layout", async () => {
    const { default: prisma, networkPrisma, query } = await loadClients();

    const sent = [];
    for (const client of [prisma, networkPrisma("mainnet")]) {
      query.mockClear();
      await client.creditCost.findMany();
      const calls: unknown[][] = query.mock.calls;
      sent.push(
        calls.map(([config]) => {
          // Without `types`: each adapter passes its own parser functions.
          const { types: _types, ...rest } = config as { types: unknown };
          return rest;
        }),
      );
    }

    expect(sent[0]).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('FROM "public"."CreditCost"'),
      }),
    ]);
    expect(sent[1]).toEqual(sent[0]);
  });

  it.each([
    ["today's layout", {}],
    [
      "the split layout",
      {
        DATABASE_SCHEMA_SHARED: "shared",
        DATABASE_SCHEMA_MAINNET: "mainnet",
        DATABASE_SCHEMA_PREPROD: "preprod",
      },
    ],
    [
      "the flag set to false",
      { ...PREPROD_ON, NETWORK_PREPROD_ENABLED: "false" },
    ],
  ])(
    "refuses the Preprod client while Preprod is off, on %s",
    async (_, env) => {
      const { networkPrisma } = await loadClients(env);

      expect(() => networkPrisma("preprod")).toThrow("Preprod is off");

      expect(mocks.createPrismaClient).toHaveBeenCalledTimes(1);
      expect(networkPrisma("mainnet")).toBeDefined();
    },
  );

  it("names each client's configured schema", async () => {
    const {
      default: prisma,
      networkPrisma,
      query,
    } = await loadClients(PREPROD_ON);

    expect(await lockSql(prisma, query)).toContain('"shared"."Lock"');
    expect(await lockSql(networkPrisma("mainnet"), query)).toContain(
      '"mainnet"."Lock"',
    );
    expect(await lockSql(networkPrisma("preprod"), query)).toContain(
      '"preprod"."Lock"',
    );
  });

  it.each([
    ["unset names", {}],
    [
      "blank names",
      {
        DATABASE_SCHEMA_SHARED: "",
        DATABASE_SCHEMA_MAINNET: "",
        DATABASE_SCHEMA_PREPROD: "",
        NETWORK_PREPROD_ENABLED: "",
      },
    ],
  ])(
    "configures the database package's raw SQL for public, Preprod off, with %s",
    async (_, env) => {
      await loadClients(env);
      const { netTable, sharedTable } = await import(
        "@sokosumi/database/sql-tables"
      );

      expect(sharedTable("user").sql).toBe('"public"."user"');
      expect(netTable("mainnet", "Job").sql).toBe('"public"."Job"');
      expect(() => netTable("preprod", "Job")).toThrow("Preprod is off");
    },
  );

  it("configures the database package's raw SQL for the schemas the environment names", async () => {
    const { default: prisma, query } = await loadClients(PREPROD_ON);
    const { netTable, sharedTable } = await import(
      "@sokosumi/database/sql-tables"
    );
    const { requeueEmptyCompanyLookups } = await import(
      "@sokosumi/database/helpers"
    );

    expect(sharedTable("user").sql).toBe('"shared"."user"');
    expect(netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
    expect(netTable("preprod", "Job").sql).toBe('"preprod"."Job"');
    query.mockClear();
    await requeueEmptyCompanyLookups(prisma, {
      before: new Date("2026-01-01T00:00:00Z"),
      apply: true,
    });
    expect(firstSql(query)).toContain('UPDATE "shared"."contact_company"');
  });

  it("reports an idle pool error once, though three clients use the pool", async () => {
    const {
      default: prisma,
      networkPrisma,
      query,
      pool,
    } = await loadClients(PREPROD_ON);
    for (const client of [
      prisma,
      networkPrisma("mainnet"),
      networkPrisma("preprod"),
    ]) {
      await lockSql(client, query);
    }
    const error = new Error("Connection terminated unexpectedly");

    pool.emit("error", error);

    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: { context: "database_pool" },
    });
  });
});
