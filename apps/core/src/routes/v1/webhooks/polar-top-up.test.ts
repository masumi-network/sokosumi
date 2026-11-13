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
    $transaction: vi.fn(),
    cmoSubscription: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    project: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
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
const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";
const PACK = {
  id: "prod_top_up_10000",
  name: "10,000 credits",
  metadata: { kind: "top-up", credits: "10000" },
};

/** `order.paid` for a pack bought in the top-up checkout. */
function topUpPaid(order: Record<string, unknown> = {}) {
  return ok({
    type: "order.paid",
    timestamp: "2026-11-13T10:00:05.000Z",
    data: {
      id: "order_1",
      billing_reason: "purchase",
      metadata: {
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
        userId: "user_1",
        kind: "top-up",
      },
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: PACK,
      subscription: null,
      ...order,
    },
  });
}

/** What the handler wrote as the grant: the transaction and its bucket. */
function grant() {
  return m.prisma.transaction.create.mock.calls[0]?.[0].data;
}

function post() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_top_up_test");
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
  m.prisma.$transaction.mockImplementation((run) => run(m.prisma));
  m.prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
  m.prisma.task.findMany.mockResolvedValue([]);
  m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
});

describe("POST /v1/webhooks/polar: order.paid for a Project top-up", () => {
  it("grants the pack's credits to the organization for the Project, for 12 months", async () => {
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid());

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(grant()).toEqual({
      amount: 10_000n * CENTS_PER_CREDIT,
      organizationId: ORGANIZATION_ID,
      userId: null,
      sourceCreditBucket: {
        create: {
          amount: 10_000n * CENTS_PER_CREDIT,
          expiresAt: new Date("2027-11-13T10:00:05.000Z"),
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          referenceId: "order_1:0",
          referenceNote: "10,000 credits",
          referenceType: "PROJECT_TOP_UP",
          userId: null,
        },
      },
    });
  });

  it("looks for the Project in the organization that paid", async () => {
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid());

    await post();

    expect(m.prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: PROJECT_ID,
          workspace: { organizationId: ORGANIZATION_ID },
        },
      }),
    );
  });

  it("leaves the Cuso's subscription as it is", async () => {
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid());

    await post();

    expect(m.prisma.cmoSubscription.create).not.toHaveBeenCalled();
    expect(m.prisma.cmoSubscription.updateMany).not.toHaveBeenCalled();
  });

  it("answers 200 and grants nothing more when the order is delivered again", async () => {
    m.prisma.transaction.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["referenceId", "referenceType"] },
      }),
    );
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid());

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it("answers 500 when the grant cannot be written, so Polar delivers again", async () => {
    m.prisma.transaction.create.mockRejectedValue(new Error("db down"));
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid());

    const response = await post();

    expect(response.status).toBe(500);
  });

  it("reports and acknowledges a Project the organization does not have", async () => {
    m.prisma.project.findFirst.mockResolvedValue(null);
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid());

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.captureMessage).toHaveBeenCalledTimes(1);
    expect(m.prisma.transaction.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no checkout metadata", { metadata: {} }],
    [
      "a Polar customer that is not the checkout's organization",
      { customer: { id: "cus_2", external_id: "org_other" } },
    ],
    [
      "a Polar customer without an external id",
      { customer: { id: "cus_2", external_id: null } },
    ],
    [
      "a product that is not a top-up pack",
      { product: { ...PACK, metadata: {} } },
    ],
    [
      "a plan bought as a one-time purchase",
      {
        product: {
          ...PACK,
          metadata: { kind: "plan", tier: "growth", credits: "25000" },
        },
      },
    ],
    ["no product", { product: null }],
  ])("reports and acknowledges an order with %s", async (_name, order) => {
    m.verifyPolarWebhook.mockResolvedValue(topUpPaid(order));

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.captureMessage).toHaveBeenCalledTimes(1);
    expect(m.prisma.transaction.create).not.toHaveBeenCalled();
  });
});
