import { OpenAPIHono } from "@hono/zod-openapi";
import { PrismaRaw } from "@sokosumi/database/client";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import router from "./index";

/** Credits are stored as cents, base 10^10 (apps/core/AGENTS.md). */
const CENTS_PER_CREDIT = 10_000_000_000n;

const m = vi.hoisted(() => ({
  verifyPolarWebhook: vi.fn(),
  captureMessage: vi.fn(),
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    polarSubscription: { updateMany: vi.fn() },
    creditBucket: { findMany: vi.fn() },
    transaction: { create: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  verifyPolarWebhook: m.verifyPolarWebhook,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: m.captureMessage,
}));

const ORGANIZATION_ID = "org_1";

function orderRefunded() {
  return ok({
    type: "order.refunded",
    timestamp: "2026-11-20T09:00:00.000Z",
    data: { id: "order_1", refunded_amount: 9900, metadata: {} },
  });
}

/** What the write-off query answers: a granted bucket and what is left of it. */
function left(id: string, credits: bigint) {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    userId: null,
    remaining: credits * CENTS_PER_CREDIT,
  };
}

function writeOff(bucketId: string, credits: bigint) {
  return {
    data: {
      amount: -credits * CENTS_PER_CREDIT,
      organizationId: ORGANIZATION_ID,
      userId: null,
      creditConsumptions: {
        create: { amount: credits * CENTS_PER_CREDIT, bucketId },
      },
    },
  };
}

function writeOffs() {
  return m.prisma.transaction.create.mock.calls.map(([args]) => args);
}

function post() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_refund_test");
    await next();
  });
  app.onError(errorHandler);
  app.route("/v1/webhooks", router);
  return app.request("http://localhost/v1/webhooks/polar", {
    method: "POST",
    body: "{}",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.verifyPolarWebhook.mockResolvedValue(orderRefunded());
  m.prisma.$transaction.mockImplementation((run) => run(m.prisma));
  m.prisma.creditBucket.findMany.mockResolvedValue([{ id: "bucket_0" }]);
  let pendingWriteOff: {
    amount: bigint;
    userId: string | null;
    organizationId: string | null;
  } | null = null;
  m.prisma.$executeRaw.mockImplementation(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("INSERT INTO") && sql.includes('"updatedAt"')) {
        pendingWriteOff = {
          amount: values[4] as bigint,
          userId: values[5] as string | null,
          organizationId: values[6] as string | null,
        };
        return 1;
      }
      if (sql.includes("bucketId") && pendingWriteOff) {
        const txRow = pendingWriteOff;
        pendingWriteOff = null;
        await m.prisma.transaction.create({
          data: {
            amount: txRow.amount,
            organizationId: txRow.organizationId,
            userId: txRow.userId,
            creditConsumptions: {
              create: {
                amount: values[3] as bigint,
                bucketId: values[4] as string,
              },
            },
          },
        });
        return 1;
      }
      return 1;
    },
  );
  m.prisma.$queryRaw.mockImplementation(
    async (first: unknown, ...rest: unknown[]) => {
      if (Array.isArray(first) && first.join("?").includes("starts_with")) {
        return m.prisma.creditBucket.findMany({
          where: {
            referenceId: { startsWith: rest[1] as string },
            referenceType: { in: rest[2] as string[] },
          },
          select: { id: true },
        });
      }
      return [];
    },
  );
  m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
});

describe("POST /v1/webhooks/polar on order.refunded", () => {
  const mockWriteOffBalances = (
    ...batches: ReturnType<typeof left>[][]
  ): void => {
    const queue = [...batches];
    m.prisma.$queryRaw.mockImplementation(
      async (first: unknown, ...rest: unknown[]) => {
        if (Array.isArray(first) && first.join("?").includes("starts_with")) {
          return m.prisma.creditBucket.findMany({
            where: {
              referenceId: { startsWith: rest[1] as string },
              referenceType: { in: rest[2] as string[] },
            },
            select: { id: true },
          });
        }
        return queue.length > 1 ? queue.shift() : (queue[0] ?? []);
      },
    );
  };

  it("writes off what is left of a partly spent grant", async () => {
    mockWriteOffBalances([left("bucket_0", 18_000n)]);

    const response = await post();

    expect(response.status).toBe(200);
    expect(writeOffs()).toEqual([writeOff("bucket_0", 18_000n)]);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("looks for every bucket the order granted, whatever its month", async () => {
    await post();

    expect(m.prisma.creditBucket.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        referenceId: { startsWith: "order_1:" },
        referenceType: { in: ["POLAR_SUBSCRIPTION_MONTH", "PROJECT_TOP_UP"] },
      },
      select: { id: true },
    });
  });

  it("leaves a fully spent grant alone", async () => {
    // The write-off query answers only buckets with something left.
    mockWriteOffBalances([]);

    const response = await post();

    expect(response.status).toBe(200);
    expect(writeOffs()).toEqual([]);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("writes off each monthly grant of a yearly order that has something left", async () => {
    m.prisma.creditBucket.findMany.mockResolvedValue([
      { id: "bucket_0" },
      { id: "bucket_1" },
      { id: "bucket_2" },
    ]);
    // Month 0 is spent; months 1 and 2 are not.
    mockWriteOffBalances([left("bucket_1", 4_000n), left("bucket_2", 25_000n)]);

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.prisma.$queryRaw.mock.calls[1]?.[0].values).toEqual(
      expect.arrayContaining(["bucket_0", "bucket_1", "bucket_2"]),
    );
    expect(writeOffs()).toEqual([
      writeOff("bucket_1", 4_000n),
      writeOff("bucket_2", 25_000n),
    ]);
  });

  it("writes off nothing more when the refund is delivered again", async () => {
    mockWriteOffBalances([left("bucket_0", 18_000n)], []);

    const first = await post();
    const again = await post();

    expect([first.status, again.status]).toEqual([200, 200]);
    expect(writeOffs()).toEqual([writeOff("bucket_0", 18_000n)]);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("records a refund that arrives before its order's payment, so the payment grants nothing", async () => {
    m.prisma.creditBucket.findMany.mockResolvedValue([]);

    const response = await post();

    expect(response.status).toBe(200);
    const [strings, ...values] = m.prisma.$executeRaw.mock.calls[0];
    const query = PrismaRaw.sql(strings, ...values);
    expect(query.sql).toContain('INSERT INTO "public"."polar_order"');
    expect(query.values).toEqual([
      "order_1",
      new Date("2026-11-20T09:00:00.000Z"),
    ]);
    // Only the bucket-id lookup runs; writeOff skips its balance query for [].
    expect(m.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(writeOffs()).toEqual([]);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("answers 500 when the write-off cannot be written, so Polar delivers again", async () => {
    mockWriteOffBalances([left("bucket_0", 18_000n)]);
    m.prisma.transaction.create.mockRejectedValue(new Error("db down"));

    const response = await post();

    expect(response.status).toBe(500);
  });
});
