/**
 * The Preprod pause and generation number on a real PostgreSQL: the module
 * (`@/helpers/preprod-control`) and its admin routes, with real credentials.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/v1/admin/networks/preprod-pause.postgres.test.ts
 */
// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { sharedTable } from "@sokosumi/database/sql-tables";
import { Hono } from "hono";
import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PREPROD_GENERATION_KEY,
  PREPROD_PAUSE_KEY,
  raisePreprodGeneration,
  readPreprodControl,
  setPreprodPaused,
} from "@/helpers/preprod-control";
import prisma from "@/lib/db/prisma";
import syncRouter from "@/routes/sync/index";
import {
  type Credential,
  createAdminCredentials,
} from "@/test-fixtures/admin-credentials";
import { createCoreApp, ORIGIN } from "@/test-fixtures/core-session";

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

const PATH = "networks/preprod/pause";
const KEYS = [PREPROD_PAUSE_KEY, PREPROD_GENERATION_KEY];

interface PauseBody {
  data: {
    paused: boolean;
    generation: number | null;
    changes: {
      id: string;
      createdAt: string;
      paused: boolean;
      reason: string;
      operator: { id: string; name: string | null };
    }[];
  };
}

/** Every statement the pool's connections send, with its bound values. */
function recordStatements() {
  const statements: unknown[][] = [];
  const query = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (
    this: Client,
    ...args: unknown[]
  ) {
    const [first, second] = args as [unknown, unknown];
    const values =
      typeof first === "object" && first !== null && "values" in first
        ? (first as { values?: unknown[] }).values
        : second;
    statements.push(Array.isArray(values) ? values : []);
    return (query as (...a: unknown[]) => unknown).apply(this, args);
  } as never);
  return { statements, restore: () => spy.mockRestore() };
}

describe.skipIf(!enabled)("Preprod pause and generation", () => {
  let app: ReturnType<typeof createCoreApp>;
  let credentials: Awaited<ReturnType<typeof createAdminCredentials>>;

  function request(
    credential: Credential,
    init: { method?: string; body?: unknown } = {},
  ) {
    return app.request(`${ORIGIN}/v1/admin/${PATH}`, {
      method: init.method ?? "GET",
      headers: {
        origin: ORIGIN,
        ...("cookie" in credential
          ? { cookie: credential.cookie }
          : { authorization: `Bearer ${credential.bearer}` }),
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  function put(credential: Credential, body: unknown) {
    return request(credential, { method: "PUT", body });
  }

  const admin = () => ({ cookie: credentials.adminCookie });

  function records() {
    return prisma.preprodAccessChange.findMany({
      where: { targetType: "network", targetId: "preprod" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { enabled: true, operatorId: true, reason: true },
    });
  }

  function pauseRow() {
    return prisma.syncMetadata.findUnique({
      where: { key: PREPROD_PAUSE_KEY },
      select: { cursorId: true },
    });
  }

  async function writePause(cursorId: string | null) {
    await prisma.syncMetadata.upsert({
      where: { key: PREPROD_PAUSE_KEY },
      create: { key: PREPROD_PAUSE_KEY, cursorId, lastSyncedAt: new Date() },
      update: { cursorId },
    });
  }

  beforeAll(async () => {
    app = createCoreApp();
    credentials = await createAdminCredentials(app, "preprod-pause");
  });

  // The two keys are one per database: each test starts with neither.
  beforeEach(async () => {
    await prisma.syncMetadata.deleteMany({ where: { key: { in: KEYS } } });
    await prisma.preprodAccessChange.deleteMany({
      where: { targetType: "network", targetId: "preprod" },
    });
  });

  afterAll(async () => {
    await prisma.syncMetadata.deleteMany({ where: { key: { in: KEYS } } });
    await prisma.preprodAccessChange.deleteMany({
      where: { targetType: "network", targetId: "preprod" },
    });
    await credentials?.cleanup();
    await prisma.$disconnect();
  });

  describe("the module", () => {
    it("is paused at generation 0 with neither row", async () => {
      await expect(readPreprodControl()).resolves.toEqual({
        paused: true,
        generation: 0,
      });
    });

    it.each([
      ["no value", null],
      ["the word paused", "paused"],
      ["a stray value", "OPEN"],
      ["an empty value", ""],
      ["a boolean's text", "false"],
    ])("is paused with %s in the pause row", async (_, cursorId) => {
      await writePause(cursorId);
      await expect(readPreprodControl()).resolves.toMatchObject({
        paused: true,
      });
    });

    it("is paused, with no generation, when the read fails", async () => {
      await writePause("open");
      vi.spyOn(prisma.syncMetadata, "findMany").mockRejectedValueOnce(
        new Error("connection lost"),
      );

      await expect(readPreprodControl()).resolves.toEqual({
        paused: true,
        generation: null,
      });
    });

    it("reads both values in one statement", async () => {
      await setPreprodPaused({
        paused: false,
        operatorId: credentials.admin.id,
        reason: "SOK-1: open",
      });
      await raisePreprodGeneration();

      const recorded = recordStatements();
      let control: Awaited<ReturnType<typeof readPreprodControl>>;
      try {
        control = await readPreprodControl();
      } finally {
        recorded.restore();
      }

      expect(control).toEqual({ paused: false, generation: 1 });
      expect(recorded.statements).toHaveLength(1);
      expect(recorded.statements[0]).toEqual(expect.arrayContaining(KEYS));
    });

    it("reads a change another host made, with no cache", async () => {
      await writePause("open");
      await expect(readPreprodControl()).resolves.toEqual({
        paused: false,
        generation: 0,
      });

      // Another Core host: a write that does not go through this module.
      await writePause("paused");
      await prisma.syncMetadata.create({
        data: {
          key: PREPROD_GENERATION_KEY,
          cursorId: "7",
          lastSyncedAt: new Date(),
        },
      });

      await expect(readPreprodControl()).resolves.toEqual({
        paused: true,
        generation: 7,
      });
    });

    it("keeps both values across a restart", async () => {
      await setPreprodPaused({
        paused: false,
        operatorId: credentials.admin.id,
        reason: "SOK-2: open",
      });
      await raisePreprodGeneration();
      await raisePreprodGeneration();

      // A fresh module, as a new Core instance loads it.
      vi.resetModules();
      const fresh = await import("@/helpers/preprod-control");

      await expect(fresh.readPreprodControl()).resolves.toEqual({
        paused: false,
        generation: 2,
      });
    });

    it("gives two raises at once two numbers", async () => {
      const raises = await Promise.all(
        Array.from({ length: 8 }, () => raisePreprodGeneration()),
      );

      expect([...raises].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      await expect(readPreprodControl()).resolves.toMatchObject({
        generation: 8,
      });
    });

    it("pauses and opens with one record per change and none for a repeat", async () => {
      const operatorId = credentials.admin.id;

      const opened = await setPreprodPaused({
        paused: false,
        operatorId,
        reason: "SOK-3: open",
      });
      const again = await setPreprodPaused({
        paused: false,
        operatorId,
        reason: "SOK-3: open again",
      });
      const paused = await setPreprodPaused({
        paused: true,
        operatorId,
        reason: "SOK-3: pause",
      });

      expect(opened).toMatchObject({ paused: false, generation: 0 });
      expect(again.changes).toHaveLength(1);
      expect(paused).toMatchObject({ paused: true, generation: 0 });
      expect(await records()).toEqual([
        { enabled: true, operatorId, reason: "SOK-3: open" },
        { enabled: false, operatorId, reason: "SOK-3: pause" },
      ]);
    });

    it("records nothing for a pause with no row: it is paused already", async () => {
      const result = await setPreprodPaused({
        paused: true,
        operatorId: credentials.admin.id,
        reason: "SOK-4: pause",
      });

      expect(result).toEqual({ paused: true, generation: 0, changes: [] });
      expect(await pauseRow()).toEqual({ cursorId: "paused" });
      expect(await records()).toEqual([]);
    });

    it("records one change for two equal switches at once", async () => {
      await Promise.all(
        ["SOK-5: a", "SOK-5: b"].map((reason) =>
          setPreprodPaused({
            paused: false,
            operatorId: credentials.admin.id,
            reason,
          }),
        ),
      );

      expect(await records()).toHaveLength(1);
    });

    it("writes only its own two keys", async () => {
      const others = () =>
        prisma.syncMetadata.findMany({
          where: { key: { notIn: KEYS } },
          orderBy: { key: "asc" },
        });
      await prisma.syncMetadata.create({
        data: {
          key: "preprod-pause-test:neighbour",
          cursorId: "open",
          lastSyncedAt: new Date(),
        },
      });
      try {
        const before = await others();

        await setPreprodPaused({
          paused: false,
          operatorId: credentials.admin.id,
          reason: "SOK-6: open",
        });
        await raisePreprodGeneration();

        expect(await others()).toEqual(before);
      } finally {
        await prisma.syncMetadata.deleteMany({
          where: { key: "preprod-pause-test:neighbour" },
        });
      }
    });

    it("keeps both values through the wipe's delete of every preprod: key", async () => {
      await setPreprodPaused({
        paused: false,
        operatorId: credentials.admin.id,
        reason: "SOK-7: open",
      });
      await raisePreprodGeneration();
      await prisma.syncMetadata.create({
        data: {
          key: "preprod:pause-test-cursor",
          lastSyncedAt: new Date(),
        },
      });

      await prisma.syncMetadata.deleteMany({
        where: { key: { startsWith: "preprod:" } },
      });

      await expect(readPreprodControl()).resolves.toEqual({
        paused: false,
        generation: 1,
      });
    });
  });

  describe("the routes", () => {
    it("pauses and opens, and records who and why", async () => {
      const opened = await put(admin(), {
        paused: false,
        reason: "  SOK-10: open  ",
      });

      expect(opened.status).toBe(200);
      expect(((await opened.json()) as PauseBody).data).toEqual({
        paused: false,
        generation: 0,
        changes: [
          {
            id: expect.any(String),
            createdAt: expect.any(String),
            paused: false,
            reason: "SOK-10: open",
            operator: { id: credentials.admin.id, name: "Ada Admin" },
          },
        ],
      });
      // What the module reads in the same process: no deploy, no restart.
      await expect(readPreprodControl()).resolves.toEqual({
        paused: false,
        generation: 0,
      });
      expect(await records()).toEqual([
        {
          enabled: true,
          operatorId: credentials.admin.id,
          reason: "SOK-10: open",
        },
      ]);

      const paused = await put(admin(), {
        paused: true,
        reason: "SOK-11: pause",
      });
      expect(paused.status).toBe(200);
      await expect(readPreprodControl()).resolves.toMatchObject({
        paused: true,
      });

      const read = await request(admin());
      expect(read.status).toBe(200);
      const { data } = (await read.json()) as PauseBody;
      expect(data.paused).toBe(true);
      expect(
        data.changes.map(({ paused, reason }) => [paused, reason]),
      ).toEqual([
        [true, "SOK-11: pause"],
        [false, "SOK-10: open"],
      ]);
    });

    it("shows the generation the wipe raised", async () => {
      await raisePreprodGeneration();
      await raisePreprodGeneration();

      const read = await request(admin());

      expect(((await read.json()) as PauseBody).data).toEqual({
        paused: true,
        generation: 2,
        changes: [],
      });
    });

    it("records nothing for a value it already has", async () => {
      await writePause("open");

      const response = await put(admin(), {
        paused: false,
        reason: "SOK-12: open again",
      });

      expect(response.status).toBe(200);
      expect(((await response.json()) as PauseBody).data.changes).toEqual([]);
      expect(await records()).toEqual([]);
    });

    it("refuses a change without a reason and changes nothing", async () => {
      for (const body of [
        { paused: false },
        { paused: false, reason: "" },
        { paused: false, reason: "   " },
        { paused: false, reason: "x".repeat(501) },
        { reason: "SOK-13: no value" },
      ]) {
        const response = await put(admin(), body);
        expect([body, response.status]).toEqual([body, 422]);
      }
      const empty = await request(admin(), { method: "PUT" });
      expect(empty.status).toBe(422);

      expect(await pauseRow()).toBeNull();
      expect(await records()).toEqual([]);
    });

    it("leaves the pause as it was when the record cannot be written", async () => {
      const table = sharedTable("preprod_access_change");
      await prisma.$executeRaw`
        ALTER TABLE ${table} ADD CONSTRAINT "preprod_pause_test_check"
        CHECK ("reason" <> 'SOK-14: refused by the database')`;
      try {
        const response = await put(admin(), {
          paused: false,
          reason: "SOK-14: refused by the database",
        });

        expect(response.status).toBe(500);
        expect(await pauseRow()).toBeNull();
        expect(await records()).toEqual([]);
        await expect(readPreprodControl()).resolves.toMatchObject({
          paused: true,
        });
      } finally {
        await prisma.$executeRaw`
          ALTER TABLE ${table} DROP CONSTRAINT "preprod_pause_test_check"`;
      }
    });

    it("lets only an admin's own browser session pause or open", async () => {
      expect(Object.keys(credentials.refused)).toEqual([
        "a user's session",
        "an Organization owner's session",
        "an admin's API key",
        "an admin's OAuth token",
        "a Coworker key",
        "a Soko Bot key of an admin",
        "an impersonated session",
        "an impersonated session whose user is an admin",
      ]);
      for (const [who, credential] of Object.entries(credentials.refused)) {
        const response = await put(credential, {
          paused: false,
          reason: "SOK-15: not allowed",
        });
        expect([who, response.status]).toEqual([who, 403]);
      }

      expect(await pauseRow()).toBeNull();
      expect(await records()).toEqual([]);
    });

    it("shows the pause to any admin credential and to no one else", async () => {
      for (const who of ["an admin's API key", "an admin's OAuth token"]) {
        const response = await request(credentials.refused[who] as Credential);
        expect([who, response.status]).toEqual([who, 200]);
        expect(((await response.json()) as PauseBody).data).toEqual({
          paused: true,
          generation: 0,
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
        const response = await request(credentials.refused[who] as Credential);
        expect([who, response.status]).toEqual([who, 403]);
      }
    });

    it("lists the 20 most recent changes, newest first", async () => {
      const first = Date.parse("2026-01-01T00:00:00.000Z");
      await prisma.preprodAccessChange.createMany({
        data: Array.from({ length: 21 }, (_, index) => ({
          createdAt: new Date(first + index * 1000),
          targetType: "network",
          targetId: "preprod",
          enabled: index % 2 === 0,
          operatorId: credentials.admin.id,
          reason: `change ${index}`,
        })),
      });

      const response = await request(admin());

      const { data } = (await response.json()) as PauseBody;
      expect(data.changes.map((change) => change.reason)).toEqual(
        Array.from({ length: 20 }, (_, index) => `change ${20 - index}`),
      );
      expect(data.changes[0]?.paused).toBe(false);
    });
  });

  describe("Mainnet", () => {
    it("reads neither key on a Mainnet request or a Mainnet cron tick", async () => {
      await writePause("open");
      const sync = new Hono();
      sync.route("/sync", syncRouter);
      const user = credentials.refused["a user's session"] as {
        cookie: string;
      };

      const recorded = recordStatements();
      try {
        for (const path of [
          "/v1/users/me",
          `/v1/users/${credentials.userId}/workspaces`,
        ]) {
          const response = await app.request(`${ORIGIN}${path}`, {
            headers: { origin: ORIGIN, cookie: user.cookie },
          });
          expect([path, response.status]).toEqual([path, 200]);
        }
        const tick = await sync.request(
          `${ORIGIN}/sync/task-x402-payment-headers-purge`,
          { headers: { authorization: "Bearer test-cron-secret" } },
        );
        expect(tick.status).toBe(200);
        const served = recorded.statements.length;

        // The control: the same recorder sees the module's read.
        await readPreprodControl();

        expect(served).toBeGreaterThan(0);
        const touching = recorded.statements.map((values) =>
          KEYS.some((key) => values.includes(key)),
        );
        // The control's statement alone, among the tick's late ones too.
        expect(touching.filter(Boolean)).toHaveLength(1);
        expect(touching.indexOf(true)).toBeGreaterThanOrEqual(served);
      } finally {
        recorded.restore();
      }
    });
  });
});
