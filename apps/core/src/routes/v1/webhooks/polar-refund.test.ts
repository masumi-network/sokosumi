import { OpenAPIHono } from "@hono/zod-openapi";
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
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
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
  m.prisma.$queryRaw.mockResolvedValue([]);
  m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
});

describe("POST /v1/webhooks/polar on order.refunded", () => {
  it("writes off what is left of a partly spent grant", async () => {
    m.prisma.$queryRaw.mockResolvedValue([left("bucket_0", 18_000n)]);

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
        referenceType: { in: ["CMO_SUBSCRIPTION_MONTH", "PROJECT_TOP_UP"] },
      },
      select: { id: true },
    });
  });

  it("leaves a fully spent grant alone", async () => {
    // The write-off query answers only buckets with something left.
    m.prisma.$queryRaw.mockResolvedValue([]);

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
    m.prisma.$queryRaw.mockResolvedValue([
      left("bucket_1", 4_000n),
      left("bucket_2", 25_000n),
    ]);

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.prisma.$queryRaw.mock.calls[0]?.[0].values).toEqual(
      expect.arrayContaining(["bucket_0", "bucket_1", "bucket_2"]),
    );
    expect(writeOffs()).toEqual([
      writeOff("bucket_1", 4_000n),
      writeOff("bucket_2", 25_000n),
    ]);
  });

  it("writes off nothing more when the refund is delivered again", async () => {
    m.prisma.$queryRaw
      .mockResolvedValueOnce([left("bucket_0", 18_000n)])
      .mockResolvedValue([]);

    const first = await post();
    const again = await post();

    expect([first.status, again.status]).toEqual([200, 200]);
    expect(writeOffs()).toEqual([writeOff("bucket_0", 18_000n)]);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("reports a refund for an order Core never granted from and acknowledges it", async () => {
    m.prisma.creditBucket.findMany.mockResolvedValue([]);

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.captureMessage).toHaveBeenCalledExactlyOnceWith(
      "Polar event ignored: the refunded order granted no credits",
      expect.objectContaining({
        extra: expect.objectContaining({ polarOrderId: "order_1" }),
      }),
    );
    expect(m.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(writeOffs()).toEqual([]);
  });

  it("answers 500 when the write-off cannot be written, so Polar delivers again", async () => {
    m.prisma.$queryRaw.mockResolvedValue([left("bucket_0", 18_000n)]);
    m.prisma.transaction.create.mockRejectedValue(new Error("db down"));

    const response = await post();

    expect(response.status).toBe(500);
  });
});
