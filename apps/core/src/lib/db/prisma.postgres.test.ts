/**
 * The `shared` client and the Network clients on one pool, against PostgreSQL.
 * Every client is pointed at a throwaway schema: `shared` gets an empty copy of
 * every `public` table, each Network copies of `Lock` and `sync_metadata`. A
 * row that lands in another schema, `public` included, shows.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/db/prisma.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient, PrismaRaw } from "@sokosumi/database/client";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const schemas = {
  shared: `n15_shared_${suffix}`,
  mainnet: `n15_mainnet_${suffix}`,
  preprod: `n15_preprod_${suffix}`,
};
const key = `network-clients-${suffix}`;
const email = `${key}@example.test`;

type Clients = typeof import("./prisma");
type Admin = ReturnType<typeof createPrismaClient>;

/** Runs every step, even after one fails, then throws what failed. */
async function runEach(steps: (() => unknown)[]) {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Teardown failed");
}

function table(schema: string, name: string) {
  return PrismaRaw.raw(`"${schema}"."${name}"`);
}

describe.runIf(enabled)("Core database clients on PostgreSQL", () => {
  let admin: Admin;
  let clients: Clients;

  async function lockKeysIn(schema: string, prefix = key) {
    const rows = await admin.$queryRaw<{ key: string }[]>`
      SELECT key FROM ${table(schema, "Lock")}
      WHERE key LIKE ${`${prefix}%`} ORDER BY key`;
    return rows.map((row) => row.key);
  }

  beforeAll(async () => {
    admin = createPrismaClient(url ?? "");
    for (const schema of Object.values(schemas)) {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    }
    // Empty copies, without foreign keys: the shared schema then holds every
    // table a sign-in touches, and nothing else.
    await admin.$executeRawUnsafe(`
      DO $$
      DECLARE t text;
      BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('CREATE TABLE %I.%I (LIKE public.%I INCLUDING ALL)', '${schemas.shared}', t, t);
        END LOOP;
      END $$`);
    for (const schema of [schemas.mainnet, schemas.preprod]) {
      for (const name of ["Lock", "sync_metadata"]) {
        await admin.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`,
        );
      }
    }
    delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
    vi.resetModules();
    vi.stubEnv("DATABASE_SCHEMA_SHARED", schemas.shared);
    vi.stubEnv("DATABASE_SCHEMA_MAINNET", schemas.mainnet);
    vi.stubEnv("DATABASE_SCHEMA_PREPROD", schemas.preprod);
    vi.stubEnv("NETWORK_PREPROD_ENABLED", "true");
    clients = await import("./prisma");
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await runEach([
      () => clients?.default.$disconnect(),
      () => clients?.networkPrisma("mainnet").$disconnect(),
      () => clients?.networkPrisma("preprod").$disconnect(),
      ...pools.map((pool) => () => pool.end()),
      // A client sent to `public` by mistake leaves its rows there.
      () => admin?.lock.deleteMany({ where: { key: { startsWith: key } } }),
      () => admin?.user.deleteMany({ where: { email } }),
      ...Object.values(schemas).map(
        (schema) => () =>
          admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`),
      ),
      () => admin?.$disconnect(),
    ]);
  });

  it("keeps each client's rows in its own schema under concurrent use", async () => {
    const { default: shared, networkPrisma } = clients;
    const writers = [
      { client: shared, prefix: "shared" },
      { client: networkPrisma("mainnet"), prefix: "mainnet" },
      { client: networkPrisma("preprod"), prefix: "preprod" },
    ];

    await Promise.all(
      writers.flatMap(({ client, prefix }) =>
        Array.from({ length: 20 }, (_, index) =>
          client.lock.create({ data: { key: `${key}:${prefix}:${index}` } }),
        ),
      ),
    );

    const expected = (prefix: string) =>
      Array.from(
        { length: 20 },
        (_, index) => `${key}:${prefix}:${index}`,
      ).sort();
    expect(await lockKeysIn(schemas.shared)).toEqual(expected("shared"));
    expect(await lockKeysIn(schemas.mainnet)).toEqual(expected("mainnet"));
    expect(await lockKeysIn(schemas.preprod)).toEqual(expected("preprod"));
    expect(await lockKeysIn("public")).toEqual([]);
  });

  it("writes shared and Network rows in one interactive transaction, and rolls both back", async () => {
    const { default: shared } = clients;
    const mainnetCursor = table(schemas.mainnet, "sync_metadata");
    const prefix = `${key}:tx:`;
    const write = (lock: string, cursor: string, fail = false) =>
      shared.$transaction(async (tx) => {
        await tx.lock.create({ data: { key: `${prefix}${lock}` } });
        await tx.$executeRaw`
          INSERT INTO ${mainnetCursor} (id, key, "lastSyncedAt", "updatedAt")
          VALUES (${randomUUID()}, ${`${prefix}${cursor}`}, now(), now())`;
        if (fail) throw new Error("abort");
      });

    await write("commit", "commit");
    await expect(write("thrown", "thrown", true)).rejects.toThrow("abort");
    // The Network side fails on its unique key after the shared row was written.
    const duplicate = await write("duplicate", "commit").then(
      () => null,
      (error: unknown) => error,
    );

    expect(String(duplicate)).toContain("23505");
    expect(await lockKeysIn(schemas.shared, prefix)).toEqual([
      `${prefix}commit`,
    ]);
    const cursors = await admin.$queryRaw<{ key: string }[]>`
      SELECT key FROM ${mainnetCursor} WHERE key LIKE ${`${prefix}%`}`;
    expect(cursors.map((row) => row.key)).toEqual([`${prefix}commit`]);
  });

  it("signs in through Core's auth route with the shared tables outside public", async () => {
    const { default: shared } = clients;
    const { default: authRouter } = await import("@/routes/auth/index");
    const app = new Hono().route("/auth", authRouter);
    const password = "fixture-password-long";
    const userId = randomUUID();
    await shared.user.create({
      data: {
        id: userId,
        name: "Network Clients Fixture",
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        accounts: {
          create: {
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ success: true, action: AUTH_CAPTCHA_ACTION }),
    );

    const origin = "https://example.com";
    const response = await app.request("/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        [AUTH_CAPTCHA_HEADER]: "fixture-turnstile-token",
      },
      body: JSON.stringify({ email, password }),
    });

    expect(response.status).toBe(200);
    const sessions = (schema: string) => admin.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM ${table(schema, "session")}
      WHERE "userId" = ${userId}`;
    expect((await sessions(schemas.shared))[0]?.count).toBe(1n);
    expect((await sessions("public"))[0]?.count).toBe(0n);
  });
});
