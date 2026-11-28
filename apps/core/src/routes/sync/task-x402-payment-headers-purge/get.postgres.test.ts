/**
 * `GET /sync/task-x402-payment-headers-purge` on a real PostgreSQL, on both
 * layouts: the cron's response, its run's result and the rows it changes. On
 * the split layout Preprod holds a payment with the same id, which the purge
 * of Mainnet must not touch.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/sync/task-x402-payment-headers-purge/get.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPrismaClient } from "@sokosumi/database/client";
import { Hono } from "hono";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { Network } from "@/lib/network";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import { copyPostgresTestDatabase } from "@/test/postgres-database-copy";
import {
  holdCommit,
  inFlow,
  observePool,
  observing,
} from "@/test/spend-comparison";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";
import type { NetworkSyncRunContext } from "../handler";

const state = vi.hoisted(() => ({
  pools: [] as Pool[],
  on: false,
  deployment: "Mainnet" as "Mainnet" | "Preprod",
  checkIn: vi.fn((..._args: unknown[]) => "test-check-in"),
}));
vi.mock("@/config/env", async (load) => {
  const actual = await load<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      DATABASE_URL: process.env.DATABASE_URL!,
      NETWORK: state.deployment,
      NETWORK_PREPROD_ENABLED: state.on,
    }),
  };
});
vi.mock("@sentry/node", async (load) => ({
  ...(await load<typeof import("@sentry/node")>()),
  captureCheckIn: state.checkIn,
}));

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
// Partial: `prisma.ts` also imports `attachDatabasePool` from here.
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  attachDatabasePool(pool: Pool) {
    state.pools.push(pool);
    observePool(pool);
  },
  waitUntil: vi.fn((work: Promise<unknown>) => {
    pending.push(work);
  }),
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");

type Client = ReturnType<typeof createPrismaClient>;

const HEADER = "n59-signed-header";
const HOUR = 60 * 60 * 1000;

/** A payment that holds a header, with only the columns the purge reads. */
async function seedPayment(client: Client, id: string, validBefore: Date) {
  onTestFinished(async () => {
    await client.taskX402Payment.deleteMany({ where: { id } });
  });
  await client.$transaction(async (tx) => {
    // The purge reads one table: skip the payment's Task, Agent and
    // Transaction, and with them the keys that cross the two sides.
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.taskX402Payment.create({
      data: {
        id,
        idempotencyKey: `n59-${id}`,
        caip2Network: "eip155:8453",
        asset: "0xasset",
        amount: "1000",
        payTo: "0xpayto",
        status: "VERIFIED",
        xPaymentHeader: HEADER,
        validBefore,
        taskId: randomUUID(),
        agentId: randomUUID(),
        transactionId: randomUUID(),
      },
    });
  });
}

const base = "/task-x402-payment-headers-purge";
const key = "task-x402-payment-headers-purge-sync";
const auth = { headers: { Authorization: "Bearer test-cron-secret" } };
let app: Hono;

function request(network: Network = "mainnet") {
  return app.request(
    `/sync${network === "preprod" ? "/preprod" : ""}${base}`,
    auth,
  );
}

/** Runs the cron as Vercel calls it and waits for its deferred work. */
async function runPurge(network: Network = "mainnet") {
  const response = await request(network);
  await Promise.all(pending.splice(0));
  return response;
}

function header(client: Client, id: string) {
  return client.taskX402Payment.findUniqueOrThrow({
    where: { id },
    select: { xPaymentHeader: true, status: true, amount: true },
  });
}

describe.skipIf(!enabled)("GET /sync/task-x402-payment-headers-purge", () => {
  // Past Core's clients: each names its schema itself.
  let mainnet: Client;
  let preprod: Client;

  let database: Awaited<ReturnType<typeof copyPostgresTestDatabase>>;
  let control: typeof import("@/helpers/preprod-control");
  let prisma: typeof import("@/lib/db/prisma").default;
  beforeAll(async () => {
    database = await copyPostgresTestDatabase(
      process.env.POSTGRES_TEST_TEMPLATE_URL ?? url!,
      "cron_test",
    );
    vi.stubEnv("DATABASE_URL", database.url);
    vi.stubEnv("DATABASE_URL_UNPOOLED", database.url);
    state.on = onSplitLayout;
    prisma = (await import("@/lib/db/prisma")).default;
    control = await import("@/helpers/preprod-control");
    const [connected] = await prisma.$queryRaw<
      { db: string }[]
    >`SELECT current_database() AS db`;
    expect(connected.db).toBe(database.name);
    const router = new Hono();
    (await import("./get")).default(router);
    app = new Hono().route("/sync", router);
    const schemas = testSchemaNames();
    mainnet = createPrismaClient(database.url, {
      schema: schemas.DATABASE_SCHEMA_MAINNET,
    });
    preprod = createPrismaClient(database.url, {
      schema: schemas.DATABASE_SCHEMA_PREPROD,
    });
  }, 60_000);

  beforeEach(async () => {
    state.on = onSplitLayout;
    state.checkIn.mockClear();
    await prisma.lock.deleteMany();
    await prisma.syncMetadata.deleteMany();
  });

  afterAll(async () => {
    await mainnet.$disconnect();
    await preprod.$disconnect();
    await Promise.all(state.pools.map((pool) => pool.end()));
    vi.unstubAllEnvs();
    await database.drop();
  }, 60_000);

  it("drops an expired header on Mainnet, keeps a live one, and reports the count", async () => {
    const expired = randomUUID();
    const live = randomUUID();
    await seedPayment(mainnet, expired, new Date(Date.now() - HOUR));
    await seedPayment(mainnet, live, new Date(Date.now() + HOUR));

    const response = await runPurge();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Syncing started" });
    expect(await header(mainnet, expired)).toEqual({
      xPaymentHeader: null,
      status: "VERIFIED",
      amount: "1000",
    });
    expect((await header(mainnet, live)).xPaymentHeader).toBe(HEADER);
    const run = coreLogEvents().find(
      (event) => event.operation === "cron_sync" && "result" in event,
    );
    expect(run).toMatchObject({
      result: { purged: 1 },
      sync: { outcome: "completed", lock: "released" },
    });
  });

  it.skipIf(onSplitLayout).each(["Mainnet", "Preprod"] as const)(
    "preserves the recorded public purge on the %s deployment",
    async (deployment) => {
      state.deployment = deployment;
      const id = "01970000-0000-7000-8000-000000000001";
      const now = new Date("2026-11-27T12:00:00Z");
      await seedPayment(mainnet, id, now);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
      try {
        const { log, outcome } = await observing(async () => {
          const response = await runPurge();
          return [response.status, await response.json()];
        });
        const record = {
          outcome,
          sql: log.map(({ text, values }) => ({ text, values })),
          locks: await prisma.lock.findMany(),
          cursors: await prisma.syncMetadata.findMany(),
          payment: await header(mainnet, id),
          monitor: state.checkIn.mock.calls,
        };
        const raw = JSON.stringify(record);
        const owner = log[4]?.values[1];
        expect(owner).toMatch(/^test-instance-id:[0-9a-f-]{36}$/);
        expect(record.locks).toHaveLength(1);
        const stable = raw
          .replaceAll(record.locks[0].id, "<lock id>")
          .replaceAll(String(owner), "<owner token>");
        expect(JSON.parse(stable)).toEqual(
          JSON.parse(
            readFileSync(
              new URL("./purge-mainnet.base.json", import.meta.url),
              "utf8",
            ),
          ),
        );
      } finally {
        vi.useRealTimers();
        state.deployment = "Mainnet";
      }
    },
  );

  it("authenticates before the off switch and skips a dark Preprod without SQL", async () => {
    state.on = false;
    const { log, outcome } = await observing(async () => {
      const denied = await app.request(`/sync/preprod${base}`);
      expect(state.checkIn).not.toHaveBeenCalled();
      const response = await runPurge("preprod");
      return [denied.status, response.status, await response.json()];
    });
    expect(outcome).toEqual([
      401,
      200,
      { message: "Sync skipped", reason: "off" },
    ]);
    expect(log).toEqual([]);
    expect(await prisma.lock.count()).toBe(0);
    expect(state.checkIn.mock.calls).toEqual([
      [
        {
          monitorSlug: "preprod-task-x402-payment-headers-purge-sync",
          status: "ok",
        },
      ],
    ]);
  });

  async function cursorRoute(
    network: Network,
    worker: (ctx: NetworkSyncRunContext) => Promise<void>,
  ) {
    const { handleSyncRequest } = await import("../handler");
    const probe = new Hono();
    probe.get("/cursor", (c) => handleSyncRequest(c, key, worker, { network }));
    const result = await probe.request("/cursor", auth);
    expect(result.status).toBe(200);
    return Promise.all(pending.splice(0));
  }

  it("only the live owner can advance, reset or clear its cursor", async () => {
    expectCoreLog("warn", "A scheduled sync's lock was not released");
    const name = "purchase-diff-sync:v2";
    const lastSyncedAt = new Date("2026-11-27T10:00:00Z");
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let resetCount: number | undefined;
    let stale: NetworkSyncRunContext["lease"] | undefined;
    const first = cursorRoute("mainnet", async ({ lease }) => {
      stale = lease;
      await lease.writeCursor(name, { cursorId: "first", lastSyncedAt });
      reached.resolve();
      await release.promise;
      await lease.writeCursor(name, { cursorId: "stale", lastSyncedAt });
    });
    try {
      await reached.promise;
      expect(
        await prisma.syncMetadata.findUniqueOrThrow({ where: { key: name } }),
      ).toMatchObject({ cursorId: "first", lastSyncedAt });
      await prisma.lock.update({
        where: { key },
        data: { lockedAt: new Date(0) },
      });
      await expect(stale?.writeCursor(name, null)).rejects.toThrow("lease");
      await cursorRoute("mainnet", async ({ lease }) => {
        await lease.writeCursor(name, null);
        resetCount = await prisma.syncMetadata.count();
        await lease.writeCursor(name, { cursorId: "successor", lastSyncedAt });
        release.resolve();
        await first;
      });
    } finally {
      release.resolve();
      await first;
    }
    expect(resetCount).toBe(0);
    expect(await prisma.syncMetadata.findMany()).toMatchObject([
      { key: name, cursorId: "successor", lastSyncedAt },
    ]);
  });

  describe.runIf(onSplitLayout)("on the split layout", () => {
    async function open() {
      await prisma.syncMetadata.create({
        data: {
          key: control.PREPROD_PAUSE_KEY,
          cursorId: "open",
          lastSyncedAt: new Date(),
        },
      });
    }
    async function operator(action: "pause" | "raise") {
      if (action === "raise") return control.raisePreprodGeneration();
      return control.setPreprodPaused({
        paused: true,
        operatorId: randomUUID(),
        reason: "cron fence test",
      });
    }

    it("skips missing control, a pause and missing route configuration before the lease", async () => {
      const { handleSyncRequest } = await import("../handler");
      const probe = new Hono();
      probe.get("/probe", (c) =>
        handleSyncRequest(c, key, async () => {}, {
          network: "preprod",
          enabled: () => false,
        }),
      );
      const { log, outcome } = await observing(async () =>
        (await probe.request("/probe", auth)).json(),
      );
      expect(outcome).toEqual({
        message: "Sync skipped",
        reason: "unconfigured",
      });
      expect(log).toEqual([]);
      async function checkPause() {
        const { log, outcome } = await observing(async () =>
          (await runPurge("preprod")).json(),
        );
        expect(outcome).toEqual({ message: "Sync skipped", reason: "paused" });
        expect(log).toHaveLength(1);
        expect(await prisma.lock.count()).toBe(0);
      }
      await checkPause();
      await open();
      await operator("pause");
      await checkPause();
    });

    it("refuses an unreadable generation without taking a lease", async () => {
      await open();
      await prisma.syncMetadata.create({
        data: {
          key: control.PREPROD_GENERATION_KEY,
          cursorId: "invalid",
          lastSyncedAt: new Date(),
        },
      });
      expectCoreLog("error", "Could not read the Preprod pause and generation");
      const response = await runPurge("preprod");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Sync skipped",
        reason: "unavailable",
      });
      expect(await prisma.lock.count()).toBe(0);
    });

    it("rechecks a generation raised between admission and lease acquisition", async () => {
      await open();
      const held = holdCommit("lease");
      const service = (await import("@/services/task-x402-payment.purge"))
        .taskX402PaymentPurgeService;
      const purge = vi.spyOn(service, "purgeExpiredTaskX402PaymentHeaders");
      const run = inFlow("lease", () => runPurge("preprod"));
      try {
        await held.reached;
        await control.raisePreprodGeneration();
        held.release();
        await run;
        expect(purge).not.toHaveBeenCalled();
        expect(
          await prisma.lock.findUniqueOrThrow({
            where: { key: `preprod:${key}` },
          }),
        ).toMatchObject({ isLocked: false });
      } finally {
        held.release();
        await run;
        purge.mockRestore();
      }
    });

    it("lets Mainnet finish while the Preprod purge holds its lease and its write transaction", async () => {
      await open();
      const id = randomUUID();
      await seedPayment(mainnet, id, new Date(0));
      await seedPayment(preprod, id, new Date(0));
      const held = holdCommit("preprod", 2);
      const running = inFlow("preprod", () => runPurge("preprod"));
      try {
        await held.reached;
        expect(
          await prisma.lock.findMany({
            where: { isLocked: true },
            select: { key: true },
          }),
        ).toEqual([{ key: `preprod:${key}` }]);
        expect((await runPurge("preprod")).status).toBe(409);
        expect((await runPurge()).status).toBe(200);
        expect((await header(mainnet, id)).xPaymentHeader).toBeNull();
        expect((await header(preprod, id)).xPaymentHeader).toBe(HEADER);
      } finally {
        held.release();
        await running;
      }
      expect((await header(preprod, id)).xPaymentHeader).toBeNull();
      expect(await prisma.syncMetadata.count()).toBe(1);
      for (const network of ["mainnet", "preprod"] as const) {
        await cursorRoute(network, async ({ lease }) => {
          await lease.writeCursor("test-progress", {
            cursorId: network,
            lastSyncedAt: new Date(0),
          });
        });
      }
      expect(
        await prisma.syncMetadata.findMany({
          where: { lastSyncedAt: new Date(0) },
          select: { key: true, cursorId: true },
          orderBy: { key: "asc" },
        }),
      ).toEqual([
        { key: "preprod:test-progress", cursorId: "preprod" },
        { key: "test-progress", cursorId: "mainnet" },
      ]);
    });

    it.each(["pause", "raise", "lease takeover"] as const)(
      "stops an admitted purge when %s commits before its write",
      async (action) => {
        await open();
        const id = randomUUID();
        await seedPayment(preprod, id, new Date(0));
        const service = (await import("@/services/task-x402-payment.purge"))
          .taskX402PaymentPurgeService;
        const purge = service.purgeExpiredTaskX402PaymentHeaders;
        const reached = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const spy = vi
          .spyOn(service, "purgeExpiredTaskX402PaymentHeaders")
          .mockImplementationOnce((db, options) =>
            purge(db, {
              ...options,
              write: async (work) => {
                reached.resolve();
                await release.promise;
                return options.write(work);
              },
            }),
          );
        const run = runPurge("preprod");
        try {
          await reached.promise;
          if (action === "lease takeover") {
            await prisma.lock.update({
              where: { key: `preprod:${key}` },
              data: { lockedBy: "successor" },
            });
            expectCoreLog("warn", "A scheduled sync's lock was not released");
          } else {
            await operator(action);
          }
        } finally {
          release.resolve();
          await run;
          spy.mockRestore();
        }
        expect((await header(preprod, id)).xPaymentHeader).toBe(HEADER);
        expect(coreLogEvents()).toContainEqual(
          expect.objectContaining({
            sync: expect.objectContaining({ outcome: "skipped" }),
          }),
        );
        expect(state.checkIn.mock.calls.at(-1)?.[0]).toMatchObject({
          status: "ok",
        });
      },
    );

    it.each(["pause", "raise"] as const)(
      "makes %s wait when the admitted write takes the fence first",
      async (action) => {
        await open();
        const id = randomUUID();
        await seedPayment(preprod, id, new Date(0));
        const held = holdCommit("preprod", 2);
        const run = inFlow("preprod", () => runPurge("preprod"));
        let change: ReturnType<typeof operator> | undefined;
        try {
          await held.reached;
          change = operator(action);
          await vi.waitFor(async () => {
            const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS (SELECT FROM pg_stat_activity
              WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0) AS waiting`;
            expect(row.waiting).toBe(true);
          });
        } finally {
          held.release();
          await Promise.all([run, change]);
        }
        expect((await header(preprod, id)).xPaymentHeader).toBeNull();
      },
    );

    it("purges only the expired Preprod header and retains Mainnet's same-id payment", async () => {
      await open();
      const id = randomUUID();
      const live = randomUUID();
      await seedPayment(mainnet, id, new Date(0));
      await seedPayment(preprod, id, new Date(0));
      await seedPayment(preprod, live, new Date(Date.now() + HOUR));
      expect((await runPurge("preprod")).status).toBe(200);
      expect((await header(mainnet, id)).xPaymentHeader).toBe(HEADER);
      expect(await header(preprod, id)).toEqual({
        xPaymentHeader: null,
        status: "VERIFIED",
        amount: "1000",
      });
      expect((await header(preprod, live)).xPaymentHeader).toBe(HEADER);
      expect(
        await prisma.lock.findMany({ select: { key: true, isLocked: true } }),
      ).toEqual([{ key: `preprod:${key}`, isLocked: false }]);
      expect(await prisma.syncMetadata.count()).toBe(1);
    });

    it("changes rows only in Mainnet's schema", async () => {
      const id = randomUUID();
      await seedPayment(mainnet, id, new Date(Date.now() - HOUR));
      await seedPayment(preprod, id, new Date(Date.now() - HOUR));
      // No search path names a schema of the layout: a bare or wrong schema
      // name in the purge finds no table instead of the right one by luck.
      const [{ schemas }] = await prisma.$queryRaw<[{ schemas: string[] }]>`
        SELECT current_schemas(true)::text[] AS schemas`;
      const names = testSchemaNames();
      for (const name of [
        names.DATABASE_SCHEMA_SHARED,
        names.DATABASE_SCHEMA_MAINNET,
        names.DATABASE_SCHEMA_PREPROD,
      ]) {
        expect(schemas).not.toContain(name);
      }

      await runPurge();

      expect((await header(mainnet, id)).xPaymentHeader).toBeNull();
      expect((await header(preprod, id)).xPaymentHeader).toBe(HEADER);
    });
  });
});
