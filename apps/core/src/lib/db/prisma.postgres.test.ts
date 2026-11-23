/**
 * The `shared` client and the Network clients on one pool, against PostgreSQL.
 * Shared stays on `public`; each Network is pointed at a throwaway schema that
 * holds copies of `Lock` and `sync_metadata`, so a row that lands in the wrong
 * schema shows.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/lib/db/prisma.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient, PrismaRaw } from "@sokosumi/database/client";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Network } from "@/lib/network";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const schemas: Record<Network, string> = {
  mainnet: `n15_mainnet_${suffix}`,
  preprod: `n15_preprod_${suffix}`,
};
const key = `network-clients-${suffix}`;
const email = `${key}@example.test`;

type Clients = typeof import("./prisma");

describe.runIf(enabled)("Core database clients on PostgreSQL", () => {
  const admin = enabled && url ? createPrismaClient(url) : null;
  let clients: Clients;

  async function lockKeysIn(schema: string) {
    if (!admin) throw new Error("Missing integration database");
    const rows = await admin.$queryRaw<{ key: string }[]>`
      SELECT key FROM ${PrismaRaw.raw(`"${schema}"."Lock"`)}
      WHERE key LIKE ${`${key}%`} ORDER BY key`;
    return rows.map((row) => row.key);
  }

  beforeAll(async () => {
    if (!admin) throw new Error("Missing integration database");
    for (const schema of Object.values(schemas)) {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      for (const table of ["Lock", "sync_metadata"]) {
        await admin.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    }
    delete (globalThis as { coreDatabase?: unknown }).coreDatabase;
    vi.resetModules();
    vi.stubEnv("DATABASE_SCHEMA_MAINNET", schemas.mainnet);
    vi.stubEnv("DATABASE_SCHEMA_PREPROD", schemas.preprod);
    clients = await import("./prisma");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await clients?.default.$disconnect();
    if (!admin) return;
    await admin.lock.deleteMany({ where: { key: { startsWith: key } } });
    await admin.user.deleteMany({ where: { email } });
    for (const schema of Object.values(schemas)) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin.$disconnect();
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
    expect(await lockKeysIn("public")).toEqual(expected("shared"));
    expect(await lockKeysIn(schemas.mainnet)).toEqual(expected("mainnet"));
    expect(await lockKeysIn(schemas.preprod)).toEqual(expected("preprod"));
    expect(
      await networkPrisma("preprod").lock.count({
        where: { key: { startsWith: `${key}:mainnet` } },
      }),
    ).toBe(0);
  });

  it("writes shared and Network rows in one interactive transaction, and rolls both back", async () => {
    const { default: shared } = clients;
    const mainnetCursor = PrismaRaw.raw(`"${schemas.mainnet}"."sync_metadata"`);
    const write = (lock: string, cursor: string, fail = false) =>
      shared.$transaction(async (tx) => {
        await tx.lock.create({ data: { key: `${key}:tx:${lock}` } });
        await tx.$executeRaw`
          INSERT INTO ${mainnetCursor} (id, key, "lastSyncedAt", "updatedAt")
          VALUES (${randomUUID()}, ${`${key}:tx:${cursor}`}, now(), now())`;
        if (fail) throw new Error("abort");
      });

    await write("commit", "commit");
    await expect(write("thrown", "thrown", true)).rejects.toThrow("abort");
    // The Network side fails on its unique key after the shared row was written.
    await expect(write("duplicate", "commit")).rejects.toThrow();

    expect(
      (await lockKeysIn("public")).filter((lock) => lock.includes(":tx:")),
    ).toEqual([`${key}:tx:commit`]);
    if (!admin) throw new Error("Missing integration database");
    const cursors = await admin.$queryRaw<{ key: string }[]>`
      SELECT key FROM ${mainnetCursor} WHERE key LIKE ${`${key}:tx:%`}`;
    expect(cursors.map((row) => row.key)).toEqual([`${key}:tx:commit`]);
  });

  it("signs in through Better Auth on the shared client while the Network schemas hold no auth tables", async () => {
    const { default: shared } = clients;
    const { auth } = await import("@/lib/auth");
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
    const response = await auth.handler(
      new Request(`${origin}/auth/sign-in/email`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          [AUTH_CAPTCHA_HEADER]: "fixture-turnstile-token",
        },
        body: JSON.stringify({ email, password }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await shared.session.count({ where: { userId } })).toBe(1);
  });
});
