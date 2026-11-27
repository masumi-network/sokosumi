/**
 * The Preprod access routes on a real PostgreSQL, with real credentials: who
 * may switch the flag, what a change records, and the migration that adds it.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/admin/preprod-access.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { rolledBack } from "@/test/split-layout";
import {
  type Credential,
  createAdminCredentials,
} from "@/test-fixtures/admin-credentials";
import {
  createCoreApp,
  createPasswordUser,
  ORIGIN,
  signIn,
} from "@/test-fixtures/core-session";

vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));
vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

type Account = Awaited<ReturnType<typeof createPasswordUser>>;

interface AccessBody {
  data: {
    enabled: boolean;
    changes: {
      id: string;
      createdAt: string;
      enabled: boolean;
      reason: string;
      operator: { id: string; name: string | null };
    }[];
  };
}

describe.skipIf(!enabled)("Preprod access", () => {
  let app: ReturnType<typeof createCoreApp>;
  const userIds: string[] = [];
  const organizationIds: string[] = [];
  let credentials: Awaited<ReturnType<typeof createAdminCredentials>>;

  let admin: Account;
  let adminCookie: string;
  /** Who is not allowed to switch, by what they hold. */
  const refused: Record<string, Credential> = {};

  async function account(name: string, role?: string) {
    const created = await createPasswordUser(name, role);
    userIds.push(created.id);
    return created;
  }

  async function organization() {
    const slug = `preprod-access-${randomUUID()}`;
    const created = await prisma.organization.create({
      data: { name: "Preprod access fixture", slug },
      select: { id: true, slug: true },
    });
    organizationIds.push(created.id);
    return created;
  }

  function request(
    credential: Credential,
    path: string,
    init: { method?: string; body?: unknown; contentType?: string | null } = {},
  ) {
    const contentType =
      init.contentType === undefined ? "application/json" : init.contentType;
    return app.request(`${ORIGIN}/v1/admin/${path}`, {
      method: init.method ?? "GET",
      headers: {
        origin: ORIGIN,
        ...("cookie" in credential
          ? { cookie: credential.cookie }
          : { authorization: `Bearer ${credential.bearer}` }),
        ...(init.body !== undefined && contentType
          ? { "content-type": contentType }
          : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  function put(credential: Credential, path: string, body: unknown) {
    return request(credential, path, { method: "PUT", body });
  }

  function recordsOf(targetId: string) {
    return prisma.preprodAccessChange.findMany({
      where: { targetId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        targetType: true,
        targetId: true,
        enabled: true,
        operatorId: true,
        reason: true,
      },
    });
  }

  async function flagOf(type: "user" | "organization", id: string) {
    const row =
      type === "user"
        ? await prisma.user.findUniqueOrThrow({ where: { id } })
        : await prisma.organization.findUniqueOrThrow({ where: { id } });
    return row.preprodEnabled;
  }

  /** A fresh user and a fresh Organization, each with its route path. */
  async function targets() {
    const user = await account("Preprod target");
    const org = await organization();
    return [
      { type: "user", id: user.id, path: `users/${user.id}/preprod-access` },
      {
        type: "organization",
        id: org.id,
        path: `organizations/${org.slug}/preprod-access`,
      },
    ] as const;
  }

  beforeAll(async () => {
    app = createCoreApp();
    credentials = await createAdminCredentials(app, "preprod-access");
    admin = credentials.admin;
    adminCookie = credentials.adminCookie;
    Object.assign(refused, credentials.refused);
  });

  afterAll(async () => {
    await prisma.preprodAccessChange.deleteMany({
      where: {
        OR: [
          { operatorId: { in: [...userIds, admin.id] } },
          { targetId: { in: [...userIds, ...organizationIds] } },
        ],
      },
    });
    await credentials?.cleanup();
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("switches the flag and records who, for whom and why", async () => {
    for (const target of await targets()) {
      const on = await put({ cookie: adminCookie }, target.path, {
        enabled: true,
        reason: "  SOK-1: pilot  ",
      });

      expect(on.status).toBe(200);
      expect(((await on.json()) as AccessBody).data).toEqual({
        enabled: true,
        changes: [
          {
            id: expect.any(String),
            createdAt: expect.any(String),
            enabled: true,
            reason: "SOK-1: pilot",
            operator: { id: admin.id, name: "Ada Admin" },
          },
        ],
      });
      expect(await flagOf(target.type, target.id)).toBe(true);
      expect(await recordsOf(target.id)).toEqual([
        {
          targetType: target.type,
          targetId: target.id,
          enabled: true,
          operatorId: admin.id,
          reason: "SOK-1: pilot",
        },
      ]);

      const off = await put({ cookie: adminCookie }, target.path, {
        enabled: false,
        reason: "SOK-2: pilot over",
      });

      expect(off.status).toBe(200);
      expect(await flagOf(target.type, target.id)).toBe(false);
      const read = await request({ cookie: adminCookie }, target.path);
      expect(read.status).toBe(200);
      const { data } = (await read.json()) as AccessBody;
      expect(data.enabled).toBe(false);
      expect(
        data.changes.map(({ enabled, reason }) => [enabled, reason]),
      ).toEqual([
        [false, "SOK-2: pilot over"],
        [true, "SOK-1: pilot"],
      ]);
    }
  });

  it("records nothing for a value the flag already has", async () => {
    for (const target of await targets()) {
      const response = await put({ cookie: adminCookie }, target.path, {
        enabled: false,
        reason: "SOK-3: already off",
      });

      expect(response.status).toBe(200);
      expect(((await response.json()) as AccessBody).data).toEqual({
        enabled: false,
        changes: [],
      });
      expect(await recordsOf(target.id)).toEqual([]);
    }
  });

  it("refuses a change without a reason and changes nothing", async () => {
    for (const target of await targets()) {
      for (const body of [
        { enabled: true },
        { enabled: true, reason: "" },
        { enabled: true, reason: "   " },
        { enabled: true, reason: "x".repeat(501) },
        { reason: "SOK-4: no value" },
      ]) {
        const response = await put({ cookie: adminCookie }, target.path, body);
        expect(response.status).toBe(422);
      }
      const untyped = await request({ cookie: adminCookie }, target.path, {
        method: "PUT",
        body: { enabled: true, reason: "SOK-4: no content type" },
        contentType: null,
      });
      expect(untyped.status).toBe(415);
      const empty = await request({ cookie: adminCookie }, target.path, {
        method: "PUT",
      });
      expect(empty.status).toBe(422);

      expect(await flagOf(target.type, target.id)).toBe(false);
      expect(await recordsOf(target.id)).toEqual([]);
    }
  });

  it("leaves the flag as it was when the record cannot be written", async () => {
    const table = sharedTable("preprod_access_change");
    await prisma.$executeRaw`
      ALTER TABLE ${table} ADD CONSTRAINT "preprod_access_change_test_check"
      CHECK ("reason" <> 'SOK-8: refused by the database')`;
    try {
      for (const target of await targets()) {
        const response = await put({ cookie: adminCookie }, target.path, {
          enabled: true,
          reason: "SOK-8: refused by the database",
        });

        expect(response.status).toBe(500);
        expect(await flagOf(target.type, target.id)).toBe(false);
        expect(await recordsOf(target.id)).toEqual([]);
      }
    } finally {
      await prisma.$executeRaw`
        ALTER TABLE ${table} DROP CONSTRAINT "preprod_access_change_test_check"`;
    }
  });

  it.each([
    ["on one host clock", 0],
    ["when its host clock is 250 ms behind", 250],
  ])(
    "lists the switch applied last as the newest, whichever transaction began first, %s",
    async (_, behindMs) => {
      const transaction = prisma.$transaction.bind(prisma);
      for (const target of await targets()) {
        let began!: () => void;
        const beginning = new Promise<void>((resolve) => {
          began = resolve;
        });
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        // The first switch's transaction begins, then waits for the second.
        vi.spyOn(prisma, "$transaction").mockImplementationOnce(
          async (callback, options) =>
            transaction(async (tx) => {
              await tx.$queryRaw`SELECT 1`;
              began();
              await released;
              return callback(tx);
            }, options),
        );
        const appliedSecond = put({ cookie: adminCookie }, target.path, {
          enabled: false,
          reason: "SOK-9: applied second",
        });
        await beginning;
        try {
          const appliedFirst = await put({ cookie: adminCookie }, target.path, {
            enabled: true,
            reason: "SOK-9: applied first",
          });
          expect(appliedFirst.status).toBe(200);
          if (behindMs > 0) {
            // Only the application's clock: the database keeps its own.
            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(Date.now() - behindMs);
          }
        } finally {
          release();
        }
        try {
          expect((await appliedSecond).status).toBe(200);
        } finally {
          vi.useRealTimers();
        }

        expect(await flagOf(target.type, target.id)).toBe(false);
        const read = await request({ cookie: adminCookie }, target.path);
        const { data } = (await read.json()) as AccessBody;
        expect(data.enabled).toBe(false);
        expect(
          data.changes.map(({ enabled, reason }) => [enabled, reason]),
        ).toEqual([
          [false, "SOK-9: applied second"],
          [true, "SOK-9: applied first"],
        ]);
      }
    },
  );

  it("answers from its own transaction when the target is deleted right after", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    for (const target of await targets()) {
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(
        async (callback, options) => {
          const result = await transaction(callback, options);
          if (target.type === "user") {
            await prisma.user.delete({ where: { id: target.id } });
          } else {
            await prisma.organization.delete({ where: { id: target.id } });
          }
          return result;
        },
      );

      const response = await put({ cookie: adminCookie }, target.path, {
        enabled: true,
        reason: "SOK-10: deleted right after",
      });

      expect(response.status).toBe(200);
      const { data } = (await response.json()) as AccessBody;
      expect(data.enabled).toBe(true);
      expect(data.changes.map(({ reason }) => reason)).toEqual([
        "SOK-10: deleted right after",
      ]);
      expect(await recordsOf(target.id)).toHaveLength(1);
    }
  });

  it("answers 404 for an unknown target and writes nothing", async () => {
    const before = await prisma.preprodAccessChange.count({
      where: { operatorId: admin.id },
    });
    for (const path of [
      `users/${randomUUID()}/preprod-access`,
      `organizations/unknown-${randomUUID()}/preprod-access`,
    ]) {
      const read = await request({ cookie: adminCookie }, path);
      expect(read.status).toBe(404);
      const write = await put({ cookie: adminCookie }, path, {
        enabled: true,
        reason: "SOK-5: unknown",
      });
      expect(write.status).toBe(404);
    }
    expect(
      await prisma.preprodAccessChange.count({
        where: { operatorId: admin.id },
      }),
    ).toBe(before);
  });

  it("lets only an admin's own browser session switch the flag", async () => {
    expect(Object.keys(refused)).toEqual([
      "a user's session",
      "an Organization owner's session",
      "an admin's API key",
      "an admin's OAuth token",
      "a Coworker key",
      "a Soko Bot key of an admin",
      "an impersonated session",
      "an impersonated session whose user is an admin",
    ]);
    for (const target of await targets()) {
      for (const [who, credential] of Object.entries(refused)) {
        const response = await put(credential, target.path, {
          enabled: true,
          reason: "SOK-6: not allowed",
        });
        expect([who, response.status]).toEqual([who, 403]);
      }
      expect(await flagOf(target.type, target.id)).toBe(false);
      expect(await recordsOf(target.id)).toEqual([]);
    }
  });

  it("names the impersonation when it refuses an impersonated admin", async () => {
    const [target] = await targets();
    const response = await put(
      refused["an impersonated session whose user is an admin"] as Credential,
      target.path,
      { enabled: true, reason: "SOK-6: not allowed" },
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as { message: string }).message).toBe(
      "Preprod access cannot be changed while impersonating",
    );
  });

  it("shows the flag to any admin credential and to no one else", async () => {
    for (const target of await targets()) {
      for (const who of ["an admin's API key", "an admin's OAuth token"]) {
        const response = await request(refused[who] as Credential, target.path);
        expect([who, response.status]).toEqual([who, 200]);
        expect(((await response.json()) as AccessBody).data).toEqual({
          enabled: false,
          changes: [],
        });
      }
      for (const who of [
        "a user's session",
        "an Organization owner's session",
        "a Coworker key",
        "a Soko Bot key of an admin",
        "an impersonated session",
      ]) {
        const response = await request(refused[who] as Credential, target.path);
        expect([who, response.status]).toEqual([who, 403]);
      }
    }
  });

  it("lists the 20 most recent changes, newest first", async () => {
    for (const target of await targets()) {
      const first = Date.parse("2026-01-01T00:00:00.000Z");
      await prisma.preprodAccessChange.createMany({
        data: Array.from({ length: 21 }, (_, index) => ({
          createdAt: new Date(first + index * 1000),
          targetType: target.type,
          targetId: target.id,
          enabled: index % 2 === 0,
          operatorId: admin.id,
          reason: `change ${index}`,
        })),
      });

      const response = await request({ cookie: adminCookie }, target.path);

      const { data } = (await response.json()) as AccessBody;
      expect(data.changes.map((change) => change.reason)).toEqual(
        Array.from({ length: 20 }, (_, index) => `change ${20 - index}`),
      );
    }
  });

  it("keeps the records when the admin, the user or the Organization is deleted", async () => {
    const operator = await account("Departing admin", "admin");
    const operatorCookie = await signIn(app, operator.email);
    const [user, org] = await targets();
    for (const target of [user, org]) {
      const response = await put({ cookie: operatorCookie }, target.path, {
        enabled: true,
        reason: "SOK-7: kept",
      });
      expect(response.status).toBe(200);
    }

    await prisma.user.delete({ where: { id: operator.id } });

    for (const target of [user, org]) {
      const read = await request({ cookie: adminCookie }, target.path);
      expect(((await read.json()) as AccessBody).data.changes).toEqual([
        expect.objectContaining({
          reason: "SOK-7: kept",
          operator: { id: operator.id, name: null },
        }),
      ]);
    }

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: org.id } });

    for (const target of [user, org]) {
      expect(await recordsOf(target.id)).toEqual([
        {
          targetType: target.type,
          targetId: target.id,
          enabled: true,
          operatorId: operator.id,
          reason: "SOK-7: kept",
        },
      ]);
    }
  });

  it("migrates without a rewrite, twice, under inserts of the previous release", async () => {
    const migration = readFileSync(
      new URL(
        "../../../../../../packages/database/prisma/migrations/20261127063336_preprod_access_flag/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await rolledBack(async (tx) => {
      // The database before the migration. The rollback puts it back.
      await tx.$executeRawUnsafe(`
        ALTER TABLE "user" DROP COLUMN "preprodEnabled";
        ALTER TABLE "organization" DROP COLUMN "preprodEnabled";
        DROP TABLE "preprod_access_change";
      `);
      const fileNodes = () =>
        tx.$queryRaw`
          SELECT pg_relation_filenode('"user"')::text AS "user",
                 pg_relation_filenode('"organization"')::text AS "organization"`;
      const before = await fileNodes();
      const userId = randomUUID();
      const organizationId = randomUUID();
      // What the previous release sends: no "preprodEnabled".
      const insertAsBefore = async (id: string) => {
        await tx.$executeRaw`
          INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
          VALUES (${id}, 'Old release', ${`${id}@example.test`}, true, NOW(), NOW())`;
        await tx.$executeRaw`
          INSERT INTO "organization" ("id", "name", "slug")
          VALUES (${id}, 'Old release', ${id})`;
      };
      await insertAsBefore(userId);

      await tx.$executeRawUnsafe(migration);

      expect(await fileNodes()).toEqual(before);
      await insertAsBefore(organizationId);
      await tx.preprodAccessChange.create({
        data: {
          targetType: "user",
          targetId: userId,
          enabled: true,
          operatorId: userId,
          reason: "kept by the second run",
        },
      });

      await tx.$executeRawUnsafe(migration);

      expect(await fileNodes()).toEqual(before);
      for (const id of [userId, organizationId]) {
        await expect(
          tx.user.findUniqueOrThrow({ where: { id } }),
        ).resolves.toMatchObject({ preprodEnabled: false });
        await expect(
          tx.organization.findUniqueOrThrow({ where: { id } }),
        ).resolves.toMatchObject({ preprodEnabled: false });
      }
      await expect(
        tx.preprodAccessChange.count({ where: { targetId: userId } }),
      ).resolves.toBe(1);
    });
  });
});
