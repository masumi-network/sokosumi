import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  captureException: vi.fn(),
  createPrismaClient: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  attachDatabasePool: mocks.attachDatabasePool,
}));
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
] as const;

const cache = globalThis as { coreDatabase?: unknown };
const cachedByOtherFiles = cache.coreDatabase;

async function importClients() {
  vi.resetModules();
  return await import("./prisma");
}

/** A fresh database module; every schema name is unset unless given. */
async function loadClients(
  schemas: Partial<Record<(typeof SCHEMA_VARIABLES)[number], string>> = {},
) {
  delete cache.coreDatabase;
  for (const name of SCHEMA_VARIABLES) vi.stubEnv(name, schemas[name]);
  mocks.attachDatabasePool.mockClear();
  mocks.createPrismaClient.mockClear();
  const query = vi
    .spyOn(Pool.prototype, "query")
    .mockImplementation(() => Promise.resolve(EMPTY_RESULT));
  const module = await importClients();
  const [pool] = mocks.attachDatabasePool.mock.calls[0] ?? [];
  if (!(pool instanceof Pool)) throw new Error("No pool was attached");
  return { ...module, query, pool };
}

async function lockSql(
  client: { lock: { findFirst: (args: object) => Promise<unknown> } },
  query: ReturnType<typeof vi.spyOn>,
) {
  query.mockClear();
  await client.lock.findFirst({ where: { key: "k" } });
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
    const { default: prisma, networkPrisma, query, pool } = await loadClients();

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
    const { default: prisma, networkPrisma, pool } = await loadClients();
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

  it("names today's public schema in every client's queries by default", async () => {
    const { default: prisma, networkPrisma, query } = await loadClients();

    for (const client of [
      prisma,
      networkPrisma("mainnet"),
      networkPrisma("preprod"),
    ]) {
      expect(await lockSql(client, query)).toContain('"public"."Lock"');
    }
  });

  it("names each client's configured schema", async () => {
    const {
      default: prisma,
      networkPrisma,
      query,
    } = await loadClients({
      DATABASE_SCHEMA_SHARED: "shared",
      DATABASE_SCHEMA_MAINNET: "mainnet",
      DATABASE_SCHEMA_PREPROD: "preprod",
    });

    expect(await lockSql(prisma, query)).toContain('"shared"."Lock"');
    expect(await lockSql(networkPrisma("mainnet"), query)).toContain(
      '"mainnet"."Lock"',
    );
    expect(await lockSql(networkPrisma("preprod"), query)).toContain(
      '"preprod"."Lock"',
    );
  });

  it("reports an idle pool error once, though three clients use the pool", async () => {
    const { default: prisma, networkPrisma, query, pool } = await loadClients();
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
