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
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { coreEvlogMiddleware, runAsBackgroundWork } from "@/lib/evlog";
import syncRouter from "@/routes/sync/index";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import { drainWaitUntil } from "@/test/wait-until";
import {
  type Credential,
  createAdminCredentials,
} from "@/test-fixtures/admin-credentials";
import { createCoreApp, ORIGIN } from "@/test-fixtures/core-session";

// Recorded, so a test can await the cron's background work (`drainWaitUntil`).
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));
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
    generation: number;
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
        state: "paused",
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
        state: "paused",
      });
    });

    it("is unavailable when the read fails, and records it in a request and in background work", async () => {
      await writePause("open");
      const findMany = vi.spyOn(prisma.syncMetadata, "findMany");
      const probe = new Hono();
      probe.use("*", coreEvlogMiddleware());
      probe.get("/probe", async (c) => c.json(await readPreprodControl()));
      const logged = expectCoreLog(
        "error",
        "Could not read the Preprod pause and generation",
        2,
      );

      findMany.mockRejectedValueOnce(new Error("connection lost"));
      const response = await probe.request("/probe");
      findMany.mockRejectedValueOnce(new Error("connection lost"));
      const background = await runAsBackgroundWork(() => readPreprodControl(), {
        syncRunId: "preprod-pause-test",
      });

      expect(await response.json()).toEqual({ state: "unavailable" });
      expect(background).toEqual({ state: "unavailable" });
      // One on the request's wide event, one standalone with the run's id.
      expect(logged.map((entry) => entry.event.syncRunId)).toEqual([
        undefined,
        "preprod-pause-test",
      ]);
      expect(logged[0]?.event.path).toBe("/probe");
    });

    it.each([
      ["no value", null],
      ["an empty value", ""],
      ["blanks", "  "],
      ["a negative", "-1"],
      ["negative zero", "-0"],
      ["a leading zero", "01"],
      ["an exponent", "1e1"],
      ["hexadecimal", "0x10"],
      ["a fraction", "1.0"],
      ["a number past the safe integers", "9007199254740992"],
    ])("is unavailable with %s in the generation row", async (_, cursorId) => {
      await writePause("open");
      await prisma.syncMetadata.create({
        data: {
          key: PREPROD_GENERATION_KEY,
          cursorId,
          lastSyncedAt: new Date(),
        },
      });
      expectCoreLog("error", "Could not read the Preprod pause and generation");

      await expect(readPreprodControl()).resolves.toEqual({
        state: "unavailable",
      });
      await expect(raisePreprodGeneration()).rejects.toThrow(
        "The stored Preprod generation is not a count; it was not raised",
      );
      await expect(
        prisma.syncMetadata.findUnique({
          where: { key: PREPROD_GENERATION_KEY },
          select: { cursorId: true },
        }),
      ).resolves.toEqual({ cursorId });
    });

    it("reads the largest safe generation and raises no further", async () => {
      await prisma.syncMetadata.create({
        data: {
          key: PREPROD_GENERATION_KEY,
          cursorId: String(Number.MAX_SAFE_INTEGER),
          lastSyncedAt: new Date(),
        },
      });

      await expect(readPreprodControl()).resolves.toEqual({
        state: "paused",
        generation: Number.MAX_SAFE_INTEGER,
      });
      await expect(raisePreprodGeneration()).rejects.toThrow(
        "The stored Preprod generation is not a count",
      );
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

      expect(control).toEqual({ state: "open", generation: 1 });
      expect(recorded.statements).toHaveLength(1);
      expect(recorded.statements[0]).toEqual(expect.arrayContaining(KEYS));
    });

    it("reads a change another host made, with no cache", async () => {
      await writePause("open");
      await expect(readPreprodControl()).resolves.toEqual({
        state: "open",
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
        state: "paused",
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
        state: "open",
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

    it("answers a repeat with one moment's state and history while an opposite switch waits", async () => {
      const operatorId = credentials.admin.id;
      await setPreprodPaused({
        paused: false,
        operatorId,
        reason: "SOK-20: open",
      });
      await setPreprodPaused({
        paused: true,
        operatorId,
        reason: "SOK-20: pause",
      });
      const transaction = prisma.$transaction.bind(prisma);
      let reached!: () => void;
      const reaching = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The repeat stops before it reads the history, after its state.
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(
        async (callback, options) =>
          transaction(
            async (tx) =>
              callback(
                new Proxy(tx, {
                  get(target, key, receiver) {
                    const value = Reflect.get(target, key, receiver);
                    if (key !== "preprodAccessChange") return value;
                    return new Proxy(value, {
                      get(delegate, method) {
                        const call = Reflect.get(delegate, method);
                        if (method !== "findMany") return call;
                        return async (...args: unknown[]) => {
                          reached();
                          await released;
                          return call.apply(delegate, args);
                        };
                      },
                    });
                  },
                }),
              ),
            options,
          ),
      );

      const repeat = setPreprodPaused({
        paused: true,
        operatorId,
        reason: "SOK-20: pause again",
      });
      let opening: ReturnType<typeof setPreprodPaused> | undefined;
      let meanwhile: string;
      try {
        await reaching;
        opening = setPreprodPaused({
          paused: false,
          operatorId,
          reason: "SOK-20: open meanwhile",
        });
        meanwhile = await Promise.race([
          opening.then(() => "committed"),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("waiting"), 500),
          ),
        ]);
      } finally {
        release();
      }

      expect(meanwhile).toBe("waiting");
      const answer = await repeat;
      expect(answer.paused).toBe(true);
      expect(answer.changes.map(({ reason }) => reason)).toEqual([
        "SOK-20: pause",
        "SOK-20: open",
      ]);
      const opened = await opening;
      expect(opened?.paused).toBe(false);
      expect(opened?.changes[0]?.reason).toBe("SOK-20: open meanwhile");
    });

    it("stamps the record with the database's clock, not the host's", async () => {
      const before = await databaseNow();
      // Only the application's clock: the database keeps its own.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() - 60_000);
      try {
        await setPreprodPaused({
          paused: false,
          operatorId: credentials.admin.id,
          reason: "SOK-21: open",
        });
      } finally {
        vi.useRealTimers();
      }
      const after = await databaseNow();

      const [record] = await prisma.preprodAccessChange.findMany({
        where: { targetType: "network", targetId: "preprod" },
      });
      expect(record?.createdAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(record?.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("answers from its own transaction, not from what commits after it", async () => {
      const transaction = prisma.$transaction.bind(prisma);
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(
        async (callback, options) => {
          const result = await transaction(callback, options);
          await writePause("paused");
          await prisma.preprodAccessChange.create({
            data: {
              targetType: "network",
              targetId: "preprod",
              enabled: false,
              operatorId: credentials.admin.id,
              reason: "SOK-22: after the commit",
            },
          });
          return result;
        },
      );

      const answer = await setPreprodPaused({
        paused: false,
        operatorId: credentials.admin.id,
        reason: "SOK-22: open",
      });

      expect(answer.paused).toBe(false);
      expect(answer.changes.map(({ reason }) => reason)).toEqual([
        "SOK-22: open",
      ]);
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
        state: "open",
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
        state: "open",
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
        state: "paused",
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

    it.each([
      ["a value that is not a count", "1e1"],
      ["no value", null],
    ])("answers 500 for %s in the generation row", async (_, cursorId) => {
      await prisma.syncMetadata.create({
        data: {
          key: PREPROD_GENERATION_KEY,
          cursorId,
          lastSyncedAt: new Date(),
        },
      });

      const read = await request(admin());

      expect(read.status).toBe(500);
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
          state: "paused",
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
    /**
     * Runs `work` while another connection holds an ACCESS EXCLUSIVE lock on
     * `sync_metadata`: any read of it, through the client or raw SQL, waits
     * for that connection, and PostgreSQL names it in the reader's
     * `pg_blocking_pids`. Asked until `work` settles; a read that waits
     * cannot settle before the lock goes, so none can be missed. The lock is
     * released at the first waiter, and in every case at the end.
     */
    async function underTableLock(work: () => Promise<unknown>) {
      let locked!: (pid: number) => void;
      const locking = new Promise<number>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            LOCK TABLE ${sharedTable("sync_metadata")} IN ACCESS EXCLUSIVE MODE`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`
            SELECT pg_backend_pid() AS pid`;
          locked(pid);
          await released;
        },
        { timeout: 30_000 },
      );
      let running: Promise<unknown> | undefined;
      try {
        const holderPid = await Promise.race([
          locking,
          holder.then(() => {
            throw new Error("The lock holder ended before it held the lock");
          }),
        ]);
        let settled = false;
        running = work().finally(() => {
          settled = true;
        });
        void running.catch(() => {});
        while (!settled) {
          const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE ${holderPid}::int = ANY (pg_blocking_pids(pid))`;
          if (waiting > 0) return "waited on sync_metadata";
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return "finished";
      } finally {
        release();
        await holder;
        await running;
      }
    }

    it("reads nothing of sync_metadata on a Mainnet request or a Mainnet cron tick, its background work included", async () => {
      await writePause("open");
      const sync = new Hono();
      sync.route("/sync", syncRouter);
      const user = credentials.refused["a user's session"] as {
        cookie: string;
      };

      const mainnet = await underTableLock(async () => {
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
        // The tick's run, its lock release included, is `waitUntil` work.
        expect(await drainWaitUntil()).toEqual([]);
        // The run itself happened: its one event says it completed.
        expect(
          coreLogEvents().filter(
            (event) =>
              event.operation === "cron_sync" &&
              (event.sync as { lockKey?: string; outcome?: string })
                ?.lockKey === "task-x402-payment-headers-purge-sync",
          ),
        ).toEqual([
          expect.objectContaining({
            sync: expect.objectContaining({ outcome: "completed" }),
          }),
        ]);
      });
      // The control: the module's own read waits on the lock.
      const control = await underTableLock(() => readPreprodControl());

      expect(mainnet).toBe("finished");
      expect(control).toBe("waited on sync_metadata");
    }, 30_000);
  });
});
