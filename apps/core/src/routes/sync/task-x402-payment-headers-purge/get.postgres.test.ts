/**
 * `GET /sync/task-x402-payment-headers-purge` on a real PostgreSQL, on both
 * layouts: the cron's response, its run's result and the rows it changes. On
 * the split layout Preprod holds a payment with the same id, which the purge
 * of Mainnet must not touch.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter core test src/routes/sync/task-x402-payment-headers-purge/get.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { Hono } from "hono";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import prisma from "@/lib/db/prisma";
import { coreLogEvents } from "@/test/core-log";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";

import mountPurge from "./get";

const pending = vi.hoisted(() => [] as Promise<unknown>[]);
// Partial: `prisma.ts` also imports `attachDatabasePool` from here.
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
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

/** Runs the cron as Vercel calls it and waits for its deferred work. */
async function runPurge() {
  const app = new Hono();
  mountPurge(app);
  const response = await app.request(
    "http://localhost/task-x402-payment-headers-purge",
    { headers: { Authorization: "Bearer test-cron-secret" } },
  );
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

  beforeAll(() => {
    const schemas = testSchemaNames();
    mainnet = createPrismaClient(url ?? "", {
      schema: schemas.DATABASE_SCHEMA_MAINNET,
    });
    preprod = createPrismaClient(url ?? "", {
      schema: schemas.DATABASE_SCHEMA_PREPROD,
    });
  });

  afterAll(async () => {
    await mainnet.$disconnect();
    await preprod.$disconnect();
  });

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

  describe.runIf(onSplitLayout)("on the split layout", () => {
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
