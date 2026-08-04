import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const {
  claimCountMock,
  claimFindManyMock,
  prismaTransactionMock,
  refundReviewedClaimMock,
  resolveReviewedClaimMock,
  retryReviewedClaimMock,
} = vi.hoisted(() => ({
  claimCountMock: vi.fn(),
  claimFindManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  refundReviewedClaimMock: vi.fn(),
  resolveReviewedClaimMock: vi.fn(),
  retryReviewedClaimMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskPaymentClaim: {
      findMany: claimFindManyMock,
      count: claimCountMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/services/task-payment-claim.service", () => ({
  refundReviewedTaskPaymentClaim: refundReviewedClaimMock,
  resolveReviewedTaskPaymentClaim: resolveReviewedClaimMock,
  retryReviewedTaskPaymentClaim: retryReviewedClaimMock,
}));

const { default: mountList } = await import("./get.js");
const { default: mountRefund } = await import("./[id]/refund/post.js");
const { default: mountResolve } = await import("./[id]/resolve/post.js");
const { default: mountRetry } = await import("./[id]/retry/post.js");

function createApp(role: string = "admin") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({ defaultHook: defaultValidationHook });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_task_payment_claim_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role,
    });
    await next();
  });
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  app.onError(errorHandler);
  mountList(app as unknown as OpenAPIHonoWithAuth);
  mountRefund(app as unknown as OpenAPIHonoWithAuth);
  mountResolve(app as unknown as OpenAPIHonoWithAuth);
  mountRetry(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("admin task payment claim routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (queries: Promise<unknown>[]) => Promise.all(queries),
    );
  });

  it("lists claims requiring review", async () => {
    claimFindManyMock.mockResolvedValue([
      {
        id: "claim-1",
        createdAt: new Date("2026-08-04T09:00:00.000Z"),
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
        network: "Preprod",
        blockchainIdentifier: "chain-1",
        failureReason: "resolver unavailable",
        attemptCount: 8,
        lastAttemptAt: new Date("2026-08-04T10:00:00.000Z"),
        nextAttemptAt: new Date("2026-08-04T16:00:00.000Z"),
        reviewRequiredAt: new Date("2026-08-04T10:00:00.000Z"),
        taskEventId: "event-1",
        transactionId: "transaction-1",
        transaction: {
          user: {
            id: "user-1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          },
        },
      },
    ]);
    claimCountMock.mockResolvedValue(1);

    const response = await createApp().request("/?limit=20");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "claim-1",
        attemptCount: 8,
        user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
      }),
    ]);
    expect(claimFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          network: "Preprod",
          reviewRequiredAt: { not: null },
        }),
      }),
    );
  });

  it("schedules a reviewed claim for a fresh retry", async () => {
    retryReviewedClaimMock.mockResolvedValue(true);

    const response = await createApp().request("/claim-1/retry", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(retryReviewedClaimMock).toHaveBeenCalledWith("claim-1");
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "retry_scheduled" },
    });
  });

  it("runs resolve-only recovery for a reviewed claim", async () => {
    resolveReviewedClaimMock.mockResolvedValue({
      status: "purchased",
      purchaseId: "purchase-1",
    });

    const response = await createApp().request("/claim-1/resolve", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(resolveReviewedClaimMock).toHaveBeenCalledWith("claim-1");
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "purchased", purchaseId: "purchase-1" },
    });
  });

  it("refunds a reviewed claim with an operator reason", async () => {
    refundReviewedClaimMock.mockResolvedValue({
      status: "refunded",
      reason: "Administrator user_admin refunded claim: invalid payload",
      compensated: true,
    });

    const response = await createApp().request("/claim-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "invalid payload" }),
    });

    expect(response.status).toBe(200);
    expect(refundReviewedClaimMock).toHaveBeenCalledWith({
      claimId: "claim-1",
      operatorId: "user_admin",
      reason: "invalid payload",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "refunded", compensated: true },
    });
  });

  it("rejects a reviewed claim refund without an operator reason", async () => {
    const response = await createApp().request("/claim-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "  " }),
    });

    expect(response.status).toBe(422);
    expect(refundReviewedClaimMock).not.toHaveBeenCalled();
  });

  it("rejects a claim that is not available for reviewed refund", async () => {
    refundReviewedClaimMock.mockResolvedValue({ status: "skipped" });

    const response = await createApp().request("/claim-1/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "invalid payload" }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects non-admin users", async () => {
    const response = await createApp("member").request("/");

    expect(response.status).toBe(403);
    expect(claimFindManyMock).not.toHaveBeenCalled();
  });
});
