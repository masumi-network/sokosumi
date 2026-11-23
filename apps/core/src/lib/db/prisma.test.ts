import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachDatabasePool: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  attachDatabasePool: mocks.attachDatabasePool,
}));
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureException: mocks.captureException,
}));

const EMPTY_RESULT = {
  command: "SELECT",
  rowCount: 0,
  oid: 0,
  fields: [],
  rows: [],
};

const cache = globalThis as { coreDatabase?: unknown };
const cachedByOtherFiles = cache.coreDatabase;

async function loadClients(schemas: Record<string, string> = {}) {
  delete cache.coreDatabase;
  vi.resetModules();
  for (const [name, value] of Object.entries(schemas)) vi.stubEnv(name, value);
  const query = vi
    .spyOn(Pool.prototype, "query")
    .mockImplementation(() => Promise.resolve(EMPTY_RESULT));
  const module = await import("./prisma");
  return { ...module, query };
}

async function lockSql(
  client: { lock: { findFirst: (args: object) => Promise<unknown> } },
  query: ReturnType<typeof vi.spyOn>,
) {
  query.mockClear();
  await client.lock.findFirst({ where: { key: "k" } });
  const [config] = query.mock.calls[0] ?? [];
  return typeof config === "string" ? config : config?.text;
}

afterEach(() => {
  cache.coreDatabase = cachedByOtherFiles;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.attachDatabasePool.mockClear();
  mocks.captureException.mockClear();
});

describe("Core database clients", () => {
  it("builds the shared client and one client per Network on one pool", async () => {
    const { default: prisma, networkPrisma } = await loadClients();

    const mainnet = networkPrisma("mainnet");
    const preprod = networkPrisma("preprod");
    expect(new Set([prisma, mainnet, preprod]).size).toBe(3);
    expect(networkPrisma("mainnet")).toBe(mainnet);
    expect(mocks.attachDatabasePool).toHaveBeenCalledTimes(1);
    const [pool] = mocks.attachDatabasePool.mock.calls[0] ?? [];
    expect(pool).toBeInstanceOf(Pool);
    expect((pool as Pool).options.max).toBe(10);
  });

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
    const { default: prisma, networkPrisma, query } = await loadClients();
    for (const client of [
      prisma,
      networkPrisma("mainnet"),
      networkPrisma("preprod"),
    ]) {
      await lockSql(client, query);
    }
    const [pool] = mocks.attachDatabasePool.mock.calls[0] ?? [];
    const error = new Error("Connection terminated unexpectedly");

    (pool as Pool).emit("error", error);

    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: { context: "database_pool" },
    });
  });
});
